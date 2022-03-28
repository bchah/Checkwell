# Checkwell
Checkwell is an MD5 Checksum server that performs asynchronous checksums via a dead-simple REST API.

This must be run from a location where NodeJS can see the paths as they are being fed. Path mapping and more fun stuff to come.

All requests require a secret key which you can set to whatever you'd like in the code (this is v0.0.1 folks.)

`GET
/md5?secret_key=security&target=/uriencoded/path/to/file`

skips the database and just returns a plaintext hash response (delay might be quite long for a large file)

`POST
/jobs/submit`

`{ secret_key:"security", 
target:"/regular/path/to/file", 
type:"md5", 
data: {"some":"custom json data you want to store against this job"}
}`

returns 201 if the job submission is successful<br/>
returns 500 if the laws of physics refuse to bend that way

`GET
/jobs/pending`

returns JSON array of any jobs which are registered but have not started processing or completed<br/>
if no jobs, returns string saying something to that effect

`GET
/jobs/complete`

returns JSON array of all completed jobs<br/>
if you include an optional ?id=12345 parameter it will just return the one job you are looking for<br/>
if you include an optional ?path=/uriencoded/path/to/file parameter it will return all jobs for that file<br/>
bonus: the path can be a folder and it will return all jobs for files at or beneath that folder<br />
if no completed jobs, returns string saying something to that effect


