
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
const secret_key = "security";

let db = new sqlite3.Database('./data.db', sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, err => {

  if (err) {
    console.error(err.message);
  }

  console.log("Initializing Database...");

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

  console.log("Database ready.");

});

function niceDate() {
  return new Date().toISOString().slice(0, 19).replace('T', ' ');
}

app.use("/", router);

const coreCount = os.cpus().length || 1;
let currentJobs = [];

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
  const items = req.body.items || null;

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

  let sql = `SELECT * FROM jobs WHERE status = ? ORDER BY id DESC LIMIT 10000`;
  let params = ["complete"]
  if (request.query.id) {
    sql = `SELECT * FROM jobs WHERE status = ? AND id = ? ORDER BY id DESC LIMIT 10000`;
    params = ["complete", request.query.id];
  } else if (request.query.target) {
    sql = `SELECT * FROM jobs WHERE status = ? AND path LIKE ? ORDER BY id DESC LIMIT 10000`;
    params = ["complete", `${request.query.target}%`];
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
  db.all(`SELECT * FROM jobs WHERE status = "pending" ORDER BY queue_time DESC LIMIT 10000`, (err, jobs) => {
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
  db.all(`SELECT * FROM jobs WHERE status = 'processing' ORDER BY queue_time DESC LIMIT 10000`, (err, jobs) => {
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

  let job_slots = coreCount - currentJobs.length;
  let pending_jobs = 0;
  let processing_jobs = 0;

  db.all(`SELECT * FROM jobs WHERE status = 'pending' ORDER BY queue_time DESC LIMIT ${job_slots}`, (err, jobs) => {
    if (err) {
      console.error(err);
    } else {
      pending_jobs = jobs.length;
      db.all(`SELECT * FROM jobs WHERE status = 'processing' ORDER BY queue_time DESC LIMIT 256`, (err, jobs) => {
        if (err) {
          console.error(err);
        } else {
          processing_jobs = jobs.length;
        }
      });
      jobs.forEach(job => {
        if (!currentJobs.find(cJob => { cJob.id == job.id })) {
          currentJobs.push(job);
          console.log(`Starting Job ${job.id}: ${job.path}`);
          db.run(`UPDATE jobs SET status = ?, start_time = ? WHERE id = ?`, ["processing", niceDate(), job.id], err => {
            if (err) {
              console.error(err);
            } else {
              md5File(job.path).then((hash) => {
                console.log(`${job.path} ==> ${hash}`);
                db.run(`UPDATE jobs SET status = ?, result = ?, finish_time = ? WHERE id = ?`, ["complete", hash, niceDate(), job.id], err => {
                  if (err) { console.error(err) };
                });
                currentJobs = currentJobs.filter(cJob => { cJob.id != job.id });
              });
            }
          });
        }
      });
    }
  });
  setTimeout(() => {
    job_slots = coreCount - currentJobs.length;
    console.log("Running service loop");
    console.log(niceDate());
    console.log(`${job_slots} job slots Available`);
    console.log(`${pending_jobs} jobs in queue`);
    console.log(`${processing_jobs} jobs processing`);
    serviceLoop(); }, 5000);
}

app.listen(80, () => { console.log("Ready for MD5s..."); serviceLoop(); });