# Checkwell
Checkwell is an MD5 Checksum server that performs asynchronous checksums via a dead-simple REST API.

This must be run from a location where NodeJS can see the paths as they are being fed. Path mapping and more fun stuff to come.

All requests require a secret key which you can set to whatever you'd like in the code (this is v0.0.1 folks.)

Jobs are limited and queued in a quite rudimentary way (ahem, 0.0.1 again) based on the number of CPU cores.

`GET
/justGetMD5?secret_key=security&target=/uriencoded/path/to/file`

returns plaintext hash response (delay might be quite long for a large file)

`POST
/jobs/submit`

{ secret_key:"security", 
target:"/regular/path/to/file", 
type:"md5", 
data: "{\"some\":\"optional stringified json data you'd like to store against this job\"}"
}

returns 201 if the job submission is successful
returns 409 if that path has already been checksummed

`GET
/jobs/pending`

returns JSON array of any jobs which are registered but have not started processing or completed
if no jobs, returns string saying something to that effect

`GET
/jobs/complete`

returns JSON array of all completed jobs
if you include an optional ?id=12345 parameter it will just return the one job you are looking for
if no completed jobs, returns string saying something to that effect


