/**
 * Background job tracking for opencode-devcontainers
 * 
 * Tracks the status of long-running container operations (start, build)
 * to enable non-blocking UI behavior in OpenCode Desktop.
 * 
 * Jobs are persisted to ~/.cache/opencode-devcontainers/jobs.json
 */

import { readFile, writeFile, mkdir, rename } from 'fs/promises'
import { existsSync } from 'fs'
import { join, dirname } from 'path'
import { PATHS } from './paths.js'

/**
 * Job status constants
 */
export const JOB_STATUS = {
  PENDING: 'pending',
  RUNNING: 'running',
  COMPLETED: 'completed',
  FAILED: 'failed',
}

/**
 * Get path to jobs file
 */
function getJobsPath() {
  return join(PATHS.cache, 'jobs.json')
}

/**
 * Read all jobs from disk
 * 
 * @returns {Promise<Object>} Map of workspace -> job data
 */
export async function readJobs() {
  const jobsPath = getJobsPath()
  
  try {
    if (!existsSync(jobsPath)) {
      return {}
    }
    const content = await readFile(jobsPath, 'utf-8')
    return JSON.parse(content)
  } catch {
    // File doesn't exist or is corrupted
    return {}
  }
}

/**
 * Write all jobs to disk
 * 
 * @param {Object} jobs - Map of workspace -> job data
 * @returns {Promise<void>}
 */
export async function writeJobs(jobs) {
  const jobsPath = getJobsPath()
  
  // Ensure directory exists
  await mkdir(dirname(jobsPath), { recursive: true })
  
  // Write atomically by writing to temp file then renaming
  const tempPath = jobsPath + '.tmp'
  await writeFile(tempPath, JSON.stringify(jobs, null, 2))
  await rename(tempPath, jobsPath)
}

/**
 * Start a new job for a workspace
 * 
 * Creates a job entry with 'pending' status. If a job already exists
 * for this workspace, it will be replaced.
 * 
 * @param {string} workspace - Workspace path
 * @param {string} repo - Repository name
 * @param {string} branch - Branch name
 * @returns {Promise<Object>} The created job
 */
export async function startJob(workspace, repo, branch) {
  const jobs = await readJobs()
  
  const job = {
    workspace,
    repo,
    branch,
    status: JOB_STATUS.PENDING,
    startedAt: new Date().toISOString(),
  }
  
  jobs[workspace] = job
  await writeJobs(jobs)
  
  return job
}

/**
 * Update the status of an existing job
 * 
 * @param {string} workspace - Workspace path
 * @param {string} status - New status (use JOB_STATUS constants)
 * @param {Object} [extra] - Additional fields to set (port, error, etc.)
 * @returns {Promise<Object|null>} Updated job or null if not found
 */
export async function updateJob(workspace, status, extra = {}) {
  const jobs = await readJobs()
  
  if (!jobs[workspace]) {
    return null
  }
  
  jobs[workspace] = {
    ...jobs[workspace],
    status,
    ...extra,
  }
  
  // Add completedAt for terminal states
  if (status === JOB_STATUS.COMPLETED || status === JOB_STATUS.FAILED) {
    jobs[workspace].completedAt = new Date().toISOString()
  }
  
  await writeJobs(jobs)
  
  return jobs[workspace]
}

/**
 * Get job for a workspace
 * 
 * @param {string} workspace - Workspace path
 * @returns {Promise<Object|null>} Job data or null if not found
 */
export async function getJob(workspace) {
  const jobs = await readJobs()
  return jobs[workspace] || null
}

/**
 * Clean up old completed and failed jobs
 * 
 * @param {Object} [options]
 * @param {number} [options.completedMaxAgeMs=3600000] - Max age for completed jobs (default: 1 hour)
 * @param {number} [options.failedMaxAgeMs=86400000] - Max age for failed jobs (default: 24 hours)
 * @returns {Promise<number>} Number of jobs removed
 */
export async function cleanupJobs(options = {}) {
  const {
    completedMaxAgeMs = 60 * 60 * 1000,      // 1 hour
    failedMaxAgeMs = 24 * 60 * 60 * 1000,    // 24 hours
  } = options
  
  const jobs = await readJobs()
  const now = Date.now()
  let removed = 0
  
  for (const [workspace, job] of Object.entries(jobs)) {
    // Only clean up terminal states
    if (job.status !== JOB_STATUS.COMPLETED && job.status !== JOB_STATUS.FAILED) {
      continue
    }
    
    const completedAt = job.completedAt ? new Date(job.completedAt).getTime() : 0
    const age = now - completedAt
    
    const maxAge = job.status === JOB_STATUS.COMPLETED ? completedMaxAgeMs : failedMaxAgeMs
    
    if (age > maxAge) {
      delete jobs[workspace]
      removed++
    }
  }
  
  if (removed > 0) {
    await writeJobs(jobs)
  }
  
  return removed
}

export default {
  JOB_STATUS,
  readJobs,
  writeJobs,
  startJob,
  updateJob,
  getJob,
  cleanupJobs,
}
