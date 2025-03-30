#!/bin/bash

npm install
npm run db:generate -w db
npm run db:migrate -w db
npm run dev -w web
