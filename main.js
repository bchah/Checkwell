
const express = require("express");
const bodyParser = require("body-parser");
const os = require("os");
const router = express.Router();
const md5File = require('md5-file');
const e = require("express");
const app = express();
const fs = require('fs');
const sqlite3 = require("sqlite3").verbose();
const secret_key = "security";


let db = new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {

  if (err) {
    console.error(err.message);
  }

  console.log("Initializing Database...");

  db.run(`CREATE TABLE IF NOT EXISTS jobs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT UNIQUE NOT NULL,
    type TEXT DEFAULT "md5" NOT NULL,
    status TEXT DEFAULT "pending" NOT NULL,
    queue_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    start_time TIMESTAMP,
    finish_time TIMESTAMP,
    result TEXT,
    user_data TEXT)`);

  console.log("Database ready.");

});

function niceDate(){
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

app.use("/", router);

const coreCount = os.cpus().length || 1;
let currentJobs = [];

app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let jsonParser = bodyParser.json();

router.get("/",(req,res)=>{
res.writeHead(200, {'content-type':'text/html'});
fs.createReadStream("./index.html").pipe(res);
});

router.get("/style.css", (req,res)=>{
fs.createReadStream("./style.css").pipe(res)
});


router.get("/justGetMD5", (request, response) => {
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.send("Sorry!");
    return false;
  }
  console.log(request.query.target);
  const target = decodeURIComponent(request.query.target);
  md5File(target).then((hash) => {
    console.log(`The MD5 sum of ${target} is: ${hash}`);
    response.send(hash);
  });
});

router.post("/jobs/submit", jsonParser, (req, res) =>{
  if (!req.body.secret_key || req.body.secret_key != secret_key) {
    response.send("Sorry!");
    return false;
  }
  const target = req.body.target;
  const type = req.body.type || "md5";
  const data = req.body.data;
  let sql = data ? `INSERT INTO jobs (path, type, data) VALUES (?, ?, ?)` : `INSERT INTO jobs (path, type) VALUES (?, ?)`;
  let params = data ? [target,type,data] : [target,type];
  db.run(sql, params, err => {
    if (err) {console.error(err); res.status(409).send({message:"Job at that path already exists."})} else {
      res.status(201).send({message:"Job submitted."});
    }
  })
  });

router.get("/jobs/complete" , (request, response) => { 
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.send("Sorry!");
    return false;
  }
  let completed_jobs = [];
  db.all(`SELECT * FROM jobs WHERE status = "complete" ORDER BY queue_time DESC`, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      if (jobs.length == 0) {
        completed_jobs = "No completed jobs (yet).";
      } else {
        jobs.forEach(job => {
          if (request.query.id) {
            if (job.id == request.query.id) {
              completed_jobs.push(job);
            }
          } else {
          completed_jobs.push(job);
          }
        });
      }
      response.send(completed_jobs);
    }

  });
});

router.get("/jobs/pending", (request, response) => {
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.send("Sorry!");
    return false;
  }
  let pending_jobs = [];
  db.all(`SELECT * FROM jobs WHERE status = "pending" ORDER BY queue_time DESC`, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      if (jobs.length == 0) {
        pending_jobs = "No pending jobs";
      } else {
        jobs.forEach(job => {
          pending_jobs.push(job);
        });
      }
      response.send(pending_jobs);
    }

  });
});

function serviceLoop() {
  let job_slots = coreCount - currentJobs.length;
  console.log("Running service loop");
  console.log(niceDate());
  console.log(`${job_slots} Job Slots Available`);
  db.all(`SELECT * FROM jobs WHERE status = "pending" ORDER BY queue_time DESC LIMIT ${job_slots}`, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      console.log(`${jobs.length} jobs pending`);
      jobs.forEach(job => {
        if (!currentJobs.find(cJob => {cJob.id == job.id})) {
          currentJobs.push(job);
          console.log(`Starting Job ${job.id}: ${job.path}`);
          db.run(`UPDATE jobs SET status = ?, start_time = ? WHERE id = ?`, ["processing", niceDate(), job.id], err => {
            if (err) {
              console.error(err);
            } else {
              md5File(job.path).then((hash) => {
                console.log(`${job.path} ==> ${hash}`);
                db.run(`UPDATE jobs SET status = ?, result = ?, finish_time = ? WHERE id = ?`, ["complete", hash, niceDate(), job.id], err => {
                  console.error(err);
                });
                currentJobs = currentJobs.filter(cJob => {cJob.id != job.id});
              });
            }
          });
        }
      });
    }
  });
  setTimeout(()=>{serviceLoop()},5000);
}

app.listen(80, () => { console.log("Ready for MD5s..."); serviceLoop(); });