import { openRuntime } from './runtime.js';
import { issueReset } from './recovery.js';
const email=process.argv[2];if(!email)throw new Error('Usage: reset:issue EMAIL');
const {db}=openRuntime();try{console.info('Deliver this single-use 30-minute token privately to the account owner:');console.info(issueReset(db.db,email));}finally{db.close();}
