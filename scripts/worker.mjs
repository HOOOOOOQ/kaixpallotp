import mysql from 'mysql2/promise';
import {runCleanup} from '../src/jobs/cleanup.mjs';
const required=['DB_HOST','DB_USER','DB_PASSWORD','DB_NAME'];
if(process.env.ENABLE_MAINTENANCE_WORKER!=='true'||required.some(key=>!process.env[key])){
  console.error('Worker disabled or database configuration incomplete.');process.exitCode=1;
} else {
  const port=Number(process.env.DB_PORT||3306);
  if(!Number.isInteger(port)||port<1||port>65535){console.error('Invalid database port.');process.exitCode=1;}
  else {
    const pool=mysql.createPool({host:process.env.DB_HOST,port,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:5000,connectionLimit:1,...(process.env.DB_TLS==='true'?{ssl:{rejectUnauthorized:true}}:{})});
    let timer,stopping=false;
    const cycle=async()=>{
      try {const result=await runCleanup(pool,process.env.DB_NAME);console.log(JSON.stringify({event:'retention_cleanup',...result}));}
      catch {console.error(JSON.stringify({event:'retention_cleanup_failed'}));}
      if(!stopping)timer=setTimeout(cycle,60*60*1000);
    };
    const stop=async()=>{if(stopping)return;stopping=true;clearTimeout(timer);await pool.end();};
    process.once('SIGTERM',stop);process.once('SIGINT',stop);await cycle();
  }
}
