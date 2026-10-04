const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const DB_FILE = path.join(__dirname, 'nouriva-data.json');

function loadDb() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { return { users: [], food_records: [], rescue_requests: [], rewards: [], counters: { users: 0, food_records: 0, rescue_requests: 0 } }; }
}
let db = loadDb();
function saveDb() { fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2), 'utf8'); }
function nextId(table) { db.counters[table] = (db.counters[table] || 0) + 1; return db.counters[table]; }

app.use(cors());
app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const sessions = new Map();
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}
function verifyPassword(password, stored) {
  const [salt, hash] = String(stored).split(':');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}
function token() { return crypto.randomBytes(32).toString('hex'); }
function auth(req, res, next) {
  const bearer = req.headers.authorization || '';
  const t = bearer.startsWith('Bearer ') ? bearer.slice(7) : '';
  const userId = sessions.get(t);
  if (!userId) return res.status(401).json({ error: 'Authentication required' });
  req.userId = userId;
  next();
}
function getRewards(userId) {
  let r = db.rewards.find(x => x.user_id === userId);
  if (!r) { r = { user_id:userId, points:0, rescued_kg:0, streak:0, record_awarded:0, safety_awarded:0, rescue_awarded:0, redistribution_awarded:0, challenge_reward_given:0 }; db.rewards.push(r); saveDb(); }
  return r;
}
function rewardJson(r) {
  return { points:r.points, rescuedKg:r.rescued_kg, streak:r.streak, actions:{ record:!!r.record_awarded, safety:!!r.safety_awarded, rescue:!!r.rescue_awarded, redistribution:!!r.redistribution_awarded }, challengeRewardGiven:!!r.challenge_reward_given };
}
function latestFood(userId) { const rows=db.food_records.filter(x=>x.user_id===userId); return rows.length ? rows[rows.length-1] : null; }
function latestRequestForFood(foodId) { const rows=db.rescue_requests.filter(x=>x.food_id===foodId); return rows.length ? rows[rows.length-1] : null; }
function foodJson(f) {
  if (!f) return null;
  const request = latestRequestForFood(f.id);
  return { id:f.id, kitchenName:f.kitchen_name, kitchenType:f.kitchen_type, pickupDetails:f.pickup_details, city:f.city, contactNo:f.contact_no, donorPortion:f.donor_portion, foodType:f.food_type, preparedAt:f.prepared_at, storageDetails:f.storage_details, freshnessRisk:f.freshness_risk, expiryDate:f.expiry_date, foodName:f.food_name, expectedPeople:f.expected_people, prepared:f.prepared, consumed:f.consumed, remaining:f.remaining, waste:f.waste, prepTime:f.prep_time, storage:f.storage, foodPhotoName:f.food_photo_name, ngo:request?.ngo || '', requestSent:!!request, safetyChecked:!!f.safety_checked };
}

app.post('/api/auth/register', (req,res) => {
  const { name, email, password } = req.body || {};
  if (!name || !email || !password || String(password).length < 4) return res.status(400).json({error:'Name, email/mobile and a password of at least 4 characters are required.'});
  const normalized=String(email).trim().toLowerCase();
  if (db.users.some(u=>u.email===normalized)) return res.status(409).json({error:'An account with this email/mobile already exists.'});
  const id=nextId('users'); const user={id,name:String(name).trim(),email:normalized,password_hash:hashPassword(String(password)),created_at:new Date().toISOString()};
  db.users.push(user); getRewards(id); saveDb(); const t=token(); sessions.set(t,id);
  res.json({token:t,user:{id,name:user.name,email:user.email}});
});
app.post('/api/auth/login', (req,res) => {
  const { email, password }=req.body||{}; const u=db.users.find(x=>x.email===String(email||'').trim().toLowerCase());
  if(!u || !verifyPassword(String(password||''),u.password_hash)) return res.status(401).json({error:'Account details not found or password is incorrect.'});
  const t=token(); sessions.set(t,u.id); res.json({token:t,user:{id:u.id,name:u.name,email:u.email}});
});

app.get('/api/state',auth,(req,res)=>{ const u=db.users.find(x=>x.id===req.userId); const f=latestFood(req.userId); const r=getRewards(req.userId); const request=f?latestRequestForFood(f.id):null; res.json({user:u?{id:u.id,name:u.name,email:u.email}:null,food:foodJson(f),rewards:rewardJson(r),trackingStep:request?.tracking_step||0,rescueRequest:request?{id:request.id,ngo:request.ngo,quantity:request.quantity,status:request.status}:null}); });

app.post('/api/food',auth,(req,res)=>{
  const d=req.body||{}; const required=['foodName','expectedPeople','prepared','consumed','remaining','prepTime','storage','donorPortion'];
  if(required.some(k=>d[k]===undefined||d[k]===''||( ['expectedPeople','prepared','consumed','remaining','donorPortion'].includes(k)&&Number.isNaN(Number(d[k]))))) return res.status(400).json({error:'Incomplete food data'});
  const prepared=Number(d.prepared),consumed=Number(d.consumed),remaining=Number(d.remaining),donor=Number(d.donorPortion);
  if(consumed>prepared||remaining>prepared||donor>remaining||[prepared,consumed,remaining,donor].some(x=>x<0)) return res.status(400).json({error:'Invalid food quantities'});
  const waste=Math.max(0,prepared-consumed-remaining); const id=nextId('food_records');
  db.food_records.push({id,user_id:req.userId,kitchen_name:d.kitchenName||'',kitchen_type:d.kitchenType||'',pickup_details:d.pickupDetails||'',city:d.city||'',contact_no:d.contactNo||'',donor_portion:donor,food_type:d.foodType||'',prepared_at:d.preparedAt||'',storage_details:d.storageDetails||'',freshness_risk:d.freshnessRisk||'',expiry_date:d.expiryDate||'',food_name:String(d.foodName).trim(),expected_people:Number(d.expectedPeople),prepared,consumed,remaining,waste,prep_time:d.prepTime,storage:d.storage,food_photo_name:d.foodPhotoName||'',safety_checked:0,created_at:new Date().toISOString()});
  const r=getRewards(req.userId); if(!r.record_awarded){r.points+=10;r.record_awarded=1;} saveDb();
  res.json({message:'Food saved',food:foodJson(latestFood(req.userId)),rewards:rewardJson(getRewards(req.userId))});
});

app.post('/api/safety',auth,(req,res)=>{const f=latestFood(req.userId);if(!f)return res.status(400).json({error:'Record food details first.'});if(!req.body||req.body.passed!==true)return res.status(400).json({error:'Complete all safety screening checks.'});f.safety_checked=1;const r=getRewards(req.userId);if(!r.safety_awarded){r.points+=10;r.safety_awarded=1;}saveDb();res.json({message:'Safety screening recorded',rewards:rewardJson(r)});});
app.post('/api/requests',auth,(req,res)=>{const f=latestFood(req.userId),ngo=String(req.body?.ngo||'').trim();if(!f||!ngo)return res.status(400).json({error:'Food and NGO are required.'});if(!f.safety_checked)return res.status(400).json({error:'Complete the safety check first.'});if(f.remaining<=0)return res.status(400).json({error:'No surplus food available.'});const kg=Number(f.donor_portion||f.remaining),id=nextId('rescue_requests');db.rescue_requests.push({id,user_id:req.userId,food_id:f.id,ngo,quantity:kg,status:'REQUESTED',tracking_step:0,created_at:new Date().toISOString()});const r=getRewards(req.userId);if(!r.rescue_awarded){r.points+=Math.round(kg*5);r.rescued_kg+=kg;r.rescue_awarded=1;}if(!r.redistribution_awarded){r.points+=20;r.redistribution_awarded=1;}saveDb();res.json({message:'Rescue request created',request:{id,ngo,quantity:kg,status:'REQUESTED'},rewards:rewardJson(r)});});
app.post('/api/tracking/advance',auth,(req,res)=>{const rows=db.rescue_requests.filter(x=>x.user_id===req.userId);const request=rows.length?rows[rows.length-1]:null;if(!request)return res.status(400).json({error:'Create a redistribution request first.'});if(request.tracking_step>=5)return res.json({trackingStep:5,rewards:rewardJson(getRewards(req.userId))});const next=request.tracking_step+1;const status=['REQUESTED','SAFETY_CHECKED','NGO_REQUESTED','NGO_ACCEPTED','PICKUP','DELIVERED'][next]||'DELIVERED';request.tracking_step=next;request.status=status;if(next===5){const r=getRewards(req.userId);r.streak+=1;if(!r.challenge_reward_given&&Number(r.rescued_kg)>=20){r.points+=100;r.challenge_reward_given=1;}}saveDb();res.json({trackingStep:next,rewards:rewardJson(getRewards(req.userId))});});
app.post('/api/prediction',auth,(req,res)=>{const people=Number(req.body?.people),perPerson=Number(req.body?.perPerson);if(!(people>0)||!(perPerson>0))return res.status(400).json({error:'Enter valid positive numbers.'});const basic=people*perPerson,recommended=basic*1.05;res.json({people,basic:Math.round(basic*10)/10,recommended:Math.round(recommended*10)/10,buffer:5});});
app.get('/api/health',(req,res)=>res.json({ok:true,service:'Nouriva Backend',time:new Date().toISOString()}));
app.get('*',(req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT,()=>console.log(`Nouriva backend running at http://localhost:${PORT}`));
