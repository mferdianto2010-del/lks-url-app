# Front-End Service (port 80)

Dashboard statis (nginx). Memanggil `/api/*` dan `/api/stats/*` lewat ALB (path relatif),
sehingga tidak memerlukan environment variable.
