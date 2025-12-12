# Nomen

A web application for collating identity proofs from multiple platforms and managing merged profiles.


## Quick Start

1. Create database and run migrations:
```bash
psql -U postgres -f migrations/000_create_database.sql && \
psql -U postgres -d nomen -f migrations/001_initial_schema.sql
```

2. Install dependencies & run:
```bash
cd ../frontend && npm install
npm run dev
npm run build
```

Open: **http://localhost:3000**
