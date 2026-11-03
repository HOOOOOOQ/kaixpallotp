import mysql from 'mysql2/promise';
import {fileURLToPath} from 'node:url';
import {readMigrations} from '../src/db/migrate.mjs';
const required=['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'], missing=required.filter(k=>!process.env[k]);
if(missing.length){console.error(`Missing configuration: ${missing.join(', ')}`);process.exitCode=1;}
else {
  let connection;
  try {
    const port=Number(process.env.DB_PORT || 3306); if(!Number.isInteger(port)||port<1||port>65535) throw Error('Invalid port');
    const files=await readMigrations(fileURLToPath(new URL('../db/migrations/',import.meta.url)));
    connection=await mysql.createConnection({host:process.env.DB_HOST,port,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:5000,...(process.env.DB_TLS==='true'?{ssl:{rejectUnauthorized:true}}:{})});
    const [rows]=await connection.query('SELECT name, checksum, state FROM schema_migrations ORDER BY name');
    const local=new Map(files.map(file=>[file.name,file]));
    for(const row of rows) if(!local.has(row.name) || local.get(row.name).checksum!==row.checksum || row.state!=='applied') throw Error('Migration mismatch');
    const applied=new Set(rows.map(row=>row.name));
    for(const file of files) console.log(`${applied.has(file.name)?'applied':'pending'}  ${file.name}`);
    if(files.some(file=>!applied.has(file.name))) process.exitCode=1;
  } catch {console.error('Unable to verify migration status. Check database connectivity, migration table and checksums.');process.exitCode=1;}
  finally {if(connection) await connection.end();}
}
