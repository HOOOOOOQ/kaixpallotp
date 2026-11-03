// Only idempotent, bounded cleanup jobs are supported. No purchases or financial writes.
export async function runCleanup(pool,database) {
  if(typeof database!=='string'||!database)throw new Error('Database name required');
  const {createHash}=await import('node:crypto');
  const lock=`pall-cleanup-${createHash('sha256').update(database).digest('hex').slice(0,40)}`;
  const conn=await pool.getConnection();let acquired=false;
  try {
    const [rows]=await conn.execute('SELECT GET_LOCK(?, 0) AS acquired',[lock]);
    if(Number(rows[0]?.acquired)!==1)return {skipped:true};
    acquired=true;await conn.beginTransaction();
    const [job]=await conn.execute("INSERT INTO background_jobs (job_type,status) VALUES ('RETENTION_CLEANUP','RUNNING')");
    const [usage]=await conn.execute('DELETE FROM api_usage_logs WHERE created_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 30 DAY) ORDER BY created_at,id LIMIT 500');
    const [sessions]=await conn.execute('DELETE FROM user_sessions WHERE expires_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 7 DAY) ORDER BY expires_at,id LIMIT 500');
    await conn.execute("DELETE FROM background_jobs WHERE status='COMPLETED' AND finished_at < DATE_SUB(UTC_TIMESTAMP(6), INTERVAL 90 DAY) ORDER BY finished_at,id LIMIT 500");
    const affected=Number(usage.affectedRows)+Number(sessions.affectedRows);
    await conn.execute("UPDATE background_jobs SET status='COMPLETED',affected_rows=?,finished_at=UTC_TIMESTAMP(6) WHERE id=?",[affected,job.insertId]);
    await conn.commit();return {skipped:false,affected};
  } catch(error) {try{await conn.rollback();}catch{}throw error;}
  finally {if(acquired){try{await conn.execute('SELECT RELEASE_LOCK(?)',[lock]);}catch{}}conn.release();}
}
