import { openRuntime } from './runtime.js';
import { encryptedBackup,restoreBackup } from './backup.js';
const secret=process.env.BACKUP_ENCRYPTION_KEY;
if(!secret)throw new Error('set BACKUP_ENCRYPTION_KEY in the process environment');
const [mode,first,second]=process.argv.slice(2);
if(mode==='create'&&first) {
  const {db}=openRuntime();try{await encryptedBackup(db.db,first,secret);console.info('Encrypted snapshot created.');}finally{db.close();}
}else if(mode==='restore'&&first&&second)console.info(restoreBackup(first,second,secret));
else throw new Error('Usage: backup create DESTINATION | backup restore SOURCE NEW_SCRATCH_DB');
