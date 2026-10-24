// Stable series-wide entry point; the legacy XP2 command remains supported.
import {main} from './xp2-adapter/install-localization.mjs';
main().catch(error=>{console.error(error.message);process.exitCode=1;});
