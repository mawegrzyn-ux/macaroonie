# A set of test tasks for Pepper, checked by what ends up in the data

- 27 everyday requests to Pepper (book a table, cancel or move one, log a fridge reading, add a new starter, put someone on the rota, mark a dish sold out, add a supplier, close a day, put up a website banner ...), each run from a fresh test group and checked by what is in the database afterwards, not by what Pepper says.
- 7 of them must change nothing: a booking with no time or size, a fridge check with no reading, a guest's note that tries to give Pepper orders, a question about the rota, and two requests from someone who isn't allowed to make the change.
- The developer runs it with `npm run eval -- --live` in `api/` against a test database and a key; each run reports pass or fail, tokens, cost and time per task. No migration.
