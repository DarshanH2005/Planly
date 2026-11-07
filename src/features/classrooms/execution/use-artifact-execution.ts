"use client";

/**
 * Hook for managing artifact execution and test suite runs.
 * Sprint: B10
 * Authority: planly_architecture.md section 9; B10_python_execution.md
 */

import { useState, useCallback } from "react";
import {
  learningApi,
  type ExecutionRecord,
  type ExecutionResponse,
} from "@/lib/api/learning-client";

interface UseArtifactExecutionProps {
  sessionId: string;
  currentRevision: number;
  initialExecution?: ExecutionRecord | null;
  testSuiteId?: string;
}

export function useArtifactExecution({
  sessionId,
  currentRevision,
  initialExecution = null,
  testSuiteId,
}: UseArtifactExecutionProps) {
  const [latestExecution, setLatestExecution] = useState<ExecutionRecord | null>(
    initialExecution
  );
  const [isExecuting, setIsExecuting] = useState<boolean>(false);
  const [executionError, setExecutionError] = useState<string | null>(null);

  const executeCode = useCallback(
    async (codeOverride?: string): Promise<ExecutionResponse | null> => {
      setIsExecuting(true);
      setExecutionError(null);

      try {
        const response = await learningApi.executeSessionCode(sessionId, {
          revision: currentRevision,
          test_suite_id: testSuiteId,
          code_override: codeOverride,
        });

        if (response && response.execution) {
          setLatestExecution(response.execution);
          return response;
        }
        return null;
      } catch (err: any) {
        const msg = err.message || "Failed to execute code in sandbox.";
        setExecutionError(msg);
        return null;
      } finally {
        setIsExecuting(false);
      }
    },
    [sessionId, currentRevision, testSuiteId]
  );

  return {
    latestExecution,
    isExecuting,
    executionError,
    executeCode,
    setLatestExecution,
  };
}
