curl -sX POST http://120.79.160.188:6001/api/v1/participants \
       -H 'content-type: application/json' \
       -H "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJsb2dhY3QiLCJpYXQiOjE3ODU4ODY0NDMsImV4cCI6MTc4NjQ5MTI0M30.AUU_VCKMsOMUcewlcAjYkSyl6uMz-nYDpVB6uOle2Zg" \
	-d '{"id":"gw-1","kind":"gateway"}' 
