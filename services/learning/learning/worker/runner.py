"""
Durable lesson worker runner.
Sprint: B09/B28

Entry point for the background worker process that:
- Polls the job queue for pending lesson turns
- Claims jobs with lease-based ownership
- Executes the LangGraph lesson workflow
- Commits results or records failures
- Recovers expired leases
"""
import signal
import sys
import time
import logging

# Same .env loading as the API: the worker is a separate process and must
# see GEMINI_API_KEY without manual env plumbing on every start.
try:
    from dotenv import load_dotenv

    load_dotenv()
except ImportError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(name)s] %(levelname)s: %(message)s'
)
logger = logging.getLogger('planly.worker')

_shutdown = False

def _handle_signal(signum, frame):
    global _shutdown
    logger.info(f'Received signal {signum}, shutting down gracefully...')
    _shutdown = True

def main(
    worker_id: str = 'lesson_worker_1',
    poll_interval: float = 2.0,
    lease_seconds: int = 60,
):
    """Main worker loop."""
    signal.signal(signal.SIGINT, _handle_signal)
    signal.signal(signal.SIGTERM, _handle_signal)
    
    logger.info(f'Worker {worker_id} starting, poll_interval={poll_interval}s')
    
    # Initialize DB on startup
    from learning.repositories.db import init_db
    init_db()
    
    from learning.worker.lesson_worker import process_next_lesson_job
    from learning.repositories.runs import recover_expired_leases
    
    consecutive_empty = 0
    while not _shutdown:
        try:
            # Recover any expired leases
            recovered = recover_expired_leases()
            if recovered:
                logger.info(f'Recovered {recovered} expired job leases')
            
            # Try to claim and process next job
            result = process_next_lesson_job(
                worker_id=worker_id,
                lease_seconds=lease_seconds,
            )
            
            if result:
                run, decision = result
                logger.info(f'Completed job run_id={run.id} state={run.state}')
                consecutive_empty = 0
            else:
                consecutive_empty += 1
                # Adaptive backoff: wait longer when queue is empty
                wait = min(poll_interval * (1 + consecutive_empty * 0.5), 30.0)
                time.sleep(wait)
                
        except KeyboardInterrupt:
            break
        except Exception as e:
            logger.error(f'Worker error: {e}', exc_info=True)
            time.sleep(poll_interval * 2)  # Back off on errors
    
    logger.info(f'Worker {worker_id} shut down')

if __name__ == '__main__':
    main()
