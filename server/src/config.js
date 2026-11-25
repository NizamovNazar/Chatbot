// Shared by the HTTP server and every CLI. Paths retain the documented server cwd.
import 'dotenv/config';
// Only this Node process; all calendar-based operational reports use Kyiv time.
process.env.TZ='Europe/Kyiv';
