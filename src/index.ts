/**
 * B.U.T.L.E.R. Alfred
 * Barış's Unified Task, Logic, Execution & Reasoning
 *
 * An AI-powered personal cognitive operations and executive assistant.
 * Bootstrap entrypoint.
 */

export const PROJECT_NAME = "B.U.T.L.E.R. Alfred";
export const REPOSITORY_NAME = "B.U.T.L.E.R.-Alfred";
export const VERSION = "0.1.0";

export function getProjectInfo() {
  return {
    name: PROJECT_NAME,
    repository: REPOSITORY_NAME,
    version: VERSION,
    status: "bootstrap"
  };
}
