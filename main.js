
const express = require("express");
const bodyParser = require("body-parser");
const os = require("os");
const router = express.Router();
const md5File = require('md5-file');
const e = require("express");
const app = express();
const fs = require('fs');
const cors = require('cors');
const sqlite3 = require("sqlite3").verbose();

// This'll stop 'em.
const secret_key = process.env.SECRET_KEY || "security";
const service_port = 80;

let timeout = null;
let serviceLoopBegan = false;
let dbHasInitialized = false;
let currentJobs = [];

let db = new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {

  console.log(`${niceDate()} : Initializing Database`);

  db.run(`CREATE TABLE IF NOT EXISTS jobs(
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    path TEXT NOT NULL,
    type TEXT DEFAULT "md5" NOT NULL,
    status TEXT DEFAULT "pending" NOT NULL,
    queue_time TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL,
    start_time TIMESTAMP,
    finish_time TIMESTAMP,
    result TEXT,
    user_data TEXT)`);

  console.log(`${niceDate()} : Database ready, starting service loop.`);

  dbHasInitialized = true;

});

function niceDate() {
  return new Date().toISOString().slice(0, 23).replace('T', ' ');
}

app.use("/", router);

const coreCount = os.cpus().length || 1;

app.use(cors({ origin: '*', methods: ['GET', 'POST'] }));
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

let jsonParser = bodyParser.json();

router.get("/", (req, res) => {
  res.writeHead(200, { 'content-type': 'text/html' });
  fs.createReadStream("./index.html").pipe(res);
});

router.get("/style.css", (req, res) => {
  fs.createReadStream("./style.css").pipe(res)
});

router.get("/refresh.svg", (req, res) => {
  fs.createReadStream("./refresh.svg").pipe(res)
});

router.get("/jquery-3.6.0.min.js", (req, res) => {
  fs.createReadStream("./jquery-3.6.0.min.js").pipe(res)
});


router.get("/md5", (request, response) => {
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

router.post("/jobs/submit", jsonParser, (req, res) => {
  if (!req.body.secret_key || req.body.secret_key != secret_key) {
    res.send("Sorry!");
    return false;
  }
  let items = req.body.items || null;

  if (items) {

    for (let i = 0; i < items.length; i++) {

      const target = items[i].target;
      const type = items[i].type || "md5";
      const data = items[i].data;
      let sql = data ? `INSERT INTO jobs (path, type, user_data) VALUES (?, ?, ?)` : `INSERT INTO jobs (path, type) VALUES (?, ?)`;
      let params = data ? [target, type, JSON.stringify(data)] : [target, type];

      db.run(sql, params, err => {
        if (err) { console.error(err); res.status(500).send({ message: "Database error." }) } else {
        }
      });

      if (i == items.length - 1) {
        res.status(201).send({ message: `Queued ${items.length} jobs` });
      }
    }

  } else {

    const target = req.body.target;
    const type = req.body.type || "md5";
    const data = req.body.data;

    let sql = data ? `INSERT INTO jobs (path, type, user_data) VALUES (?, ?, ?)` : `INSERT INTO jobs (path, type) VALUES (?, ?)`;
    let params = data ? [target, type, JSON.stringify(data)] : [target, type];

    db.run(sql, params, err => {
      if (err) { console.error(err); res.status(500).send({ message: "Database error." }) } else {
        res.status(201).send({ message: `Job queued for ${target}` });
      }
    });

  }

});

router.get("/jobs/complete", (request, response) => {
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.status(403).send("Sorry!");
    return false;
  }
  let completed_jobs = [];

  let sql = `SELECT * FROM jobs WHERE status IN ("complete","failed") ORDER BY id DESC LIMIT 10000`;
  let params = [];
  if (request.query.id) {
    sql = `SELECT * FROM jobs WHERE status IN ("complete","failed") AND id = ? ORDER BY id DESC LIMIT 10000`;
    params = [request.query.id];
  } else if (request.query.target) {
    sql = `SELECT * FROM jobs WHERE status IN ("complete","failed") AND path LIKE ? ORDER BY id DESC LIMIT 10000`;
    params = [`${request.query.target}%`];
  }

  db.all(sql, params, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      if (jobs.length == 0) {
        completed_jobs = "No completed jobs (yet).";
      } else {
        jobs.forEach(job => {
          completed_jobs.push(job);
        });
      }
      response.send(completed_jobs);
    }

  });
});

router.get("/jobs/pending", (request, response) => {
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.status(403).send("Sorry!");
    return false;
  }
  let pending_jobs = [];
  db.all(`SELECT * FROM jobs WHERE status = "pending" ORDER BY queue_time ASC LIMIT 10000`, (err, jobs) => {
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

router.get("/jobs/processing", (request, response) => {
  if (!request.query.secret_key || request.query.secret_key != secret_key) {
    response.status(403).send("Sorry!");
    return false;
  }
  let processing_jobs = [];
  db.all(`SELECT * FROM jobs WHERE status = 'processing' ORDER BY start_time DESC LIMIT 10000`, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      if (jobs.length == 0) {
        processing_jobs = "No processing jobs";
      } else {
        jobs.forEach(job => {
          processing_jobs.push(job);
        });
      }
      response.send(processing_jobs);
    }

  });
});

function serviceLoop() {

  if (!dbHasInitialized) {
    timeout = setTimeout(() => { serviceLoop() }, 1000);
    return;
  } else if (!serviceLoopBegan) {
    clearTimeout(timeout);
    timeout = null;

    // Check for orphaned processing jobs from last shut down
    db.all(`SELECT * FROM jobs WHERE status = 'processing' ORDER BY queue_time DESC LIMIT 256`, (err, orphanedJobs) => {
      if (err) {
        console.error(err);
      } else {
        if (Array.isArray(orphanedJobs) && orphanedJobs.length > 0) {
          console.log(`${niceDate()} : ${orphanedJobs.length} jobs were processing when Checkwell was last shut down. These jobs will show as failed.`);
          db.run(`UPDATE jobs SET status = 'failed' WHERE status = 'processing'`, err => {
            if (err) {
              console.error(err);
            }
          });
        }
      }
    });

    console.log(`${niceDate()} : Checkwell is ready for action! Now listening on port ${service_port}`);
    serviceLoopBegan = true;
  }

  let job_slots = coreCount;

  db.all(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY queue_time ASC LIMIT 10000`, (err, pendingJobs) => {
    if (err) {
      console.error(err);
    } else {
      if (Array.isArray(pendingJobs) && pendingJobs.length > 0) console.log(`${niceDate()} : ${pendingJobs.length} jobs in queue`);
      db.all(`SELECT * FROM jobs WHERE status = 'processing' ORDER BY queue_time ASC LIMIT 256`, (err, procJobs) => {
        if (err) {
          console.error(err);
        } else {
          if (Array.isArray(procJobs) && procJobs.length > 0) { 
          job_slots = coreCount - procJobs.length;
          console.log(`${niceDate()} : ${procJobs.length} jobs processing`);
          }
        }

        pendingJobs.forEach(job => {
          if (!currentJobs.find(cJob => { cJob.id == job.id })) {
            if (job.status != "failed") {
              if (job_slots > 0) {
                currentJobs.push(job)
                job_slots--;
              } else {
                return;
              }
            } else {
              currentJobs = currentJobs.filter(cJob => { cJob.id != job.id });
              return;
            }
            console.log(`${niceDate()} : Starting Job ${job.id}: ${job.path}`);
            db.run(`UPDATE jobs SET status = ?, start_time = ? WHERE id = ?`, ["processing", niceDate(), job.id], err => {
              if (err) {
                console.error(err);
              } else {
                md5File(job.path).then((hash) => {
                  console.log(`${niceDate()} : Job suceeded for ${job.path}\n${niceDate()} : MD5 ==> ${hash}`);
                  db.run(`UPDATE jobs SET status = ?, result = ?, finish_time = ? WHERE id = ?`, ["complete", hash, niceDate(), job.id], err => {
                    if (err) { console.error(err) };
                    currentJobs = currentJobs.filter(cJob => { cJob.id != job.id });
                  });

                }, (err) => {
                  console.error(err);
                  console.log(`${niceDate()} : Job failed for ${job.path}`);
                  db.run(`UPDATE jobs SET status = ?, finish_time = ? WHERE id = ?`, ["failed", niceDate(), job.id], err => {
                    if (err) { console.error(err) };
                    currentJobs = currentJobs.filter(cJob => { cJob.id != job.id });
                  });
                });
              }
            });
          }
        });

      });
    }
  });

  if (job_slots < coreCount) console.log(`${niceDate()} : ${job_slots} job slots available`);

  clearTimeout(timeout);
  timeout = setTimeout(() => {
    serviceLoop();
  }, 1000);
}

app.listen(service_port, () => { console.log(`${niceDate()} : Starting Checkwell`); serviceLoop(); });