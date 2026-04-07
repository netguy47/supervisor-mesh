# Supervisor Mesh Protocol

## Overview

The Supervisor Mesh is a multi-agent system where specialized agents collaborate to accomplish complex tasks. This protocol defines how agents communicate, coordinate, and maintain state throughout execution.

## Architecture Components

### 1. Supervisor
- **Role**: Orchestrator and coordinator
- **Responsibilities**: 
  - Receive user goals
  - Delegate to Planner for strategy
  - Coordinate Worker for execution
  - Invoke Verifier for validation
  - Manage workflow state and retries
- **Interface**: Handles user interaction and system coordination

### 2. Planner Agent
- **Role**: Strategic planner
- **Responsibilities**:
  - Analyze goals and context
  - Generate step-by-step execution plans
  - Identify required tools and skills
  - Estimate complexity and dependencies
- **Output**: Structured Plan object with executable steps

### 3. Worker Agent
- **Role**: Execution engine
- **Responsibilities**:
  - Execute individual steps from the plan
  - Apply file changes using Antigravity Editor
  - Invoke tools and skills as needed
  - Capture execution results and errors
- **Output**: ExecutionResult object with diffs and outcomes

### 4. Verifier Agent
- **Role**: Quality assurance
- **Responsibilities**:
  - Validate completed steps
  - Check for correctness and completeness
  - Run tests if applicable
  - Identify issues requiring rework
- **Output**: VerificationReport with pass/fail status and feedback

### 5. Engine
- **Role**: Infrastructure coordinator
- **Responsibilities**:
  - Manage available skills and tools
  - Handle workflow execution
  - Provide utilities for file operations
  - Maintain system state
- **Interface**: Service layer for all agents

## Message Protocol

### Message Structure
All messages between components follow this structure:

```javascript
{
  "type": "message_type",
  "from": "agent_name",
  "to": "agent_name",
  "timestamp": ISO_8601_timestamp,
  "correlationId": "unique_id",
  "payload": { /* type-specific data */ }
}
```

### Message Types

#### 1. GoalRequest (User → Supervisor)
```javascript
{
  "type": "GoalRequest",
  "from": "user",
  "to": "supervisor",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "goal": "User's goal description",
    "context": { /* optional context */ },
    "priority": "high|medium|low"
  }
}
```

#### 2. PlanRequest (Supervisor → Planner)
```javascript
{
  "type": "PlanRequest",
  "from": "supervisor",
  "to": "planner",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "goal": "Goal to achieve",
    "context": { /* context information */ },
    "constraints": {
      "maxSteps": 10,
      "maxDuration": "30m"
    }
  }
}
```

#### 3. PlanResponse (Planner → Supervisor)
```javascript
{
  "type": "PlanResponse",
  "from": "planner",
  "to": "supervisor",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "status": "success|error",
    "plan": {
      "id": "plan-uuid",
      "goal": "Original goal",
      "steps": [
        {
          "id": "step-1",
          "description": "Step description",
          "action": "create|update|delete|execute",
          "target": { /* file, tool, or resource */ },
          "dependencies": [],
          "estimatedDuration": "5m",
          "requiredSkills": ["skill-name"]
        }
      ],
      "totalEstimatedDuration": "30m"
    },
    "error": null // if status is error
  }
}
```

#### 4. ExecuteRequest (Supervisor → Worker)
```javascript
{
  "type": "ExecuteRequest",
  "from": "supervisor",
  "to": "worker",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "planId": "plan-uuid",
    "stepId": "step-1",
    "step": { /* step object from plan */ },
    "context": { /* execution context */ }
  }
}
```

#### 5. ExecutionResult (Worker → Supervisor)
```javascript
{
  "type": "ExecutionResult",
  "from": "worker",
  "to": "supervisor",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "status": "success|error|partial",
    "stepId": "step-1",
    "duration": "2.5m",
    "output": { /* execution output */ },
    "diffs": [
      {
        "path": "/path/to/file.js",
        "operation": "create|update|delete",
        "changes": "diff content"
      }
    ],
    "error": null
  }
}
```

#### 6. VerifyRequest (Supervisor → Verifier)
```javascript
{
  "type": "VerifyRequest",
  "from": "supervisor",
  "to": "verifier",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "stepId": "step-1",
    "expectedOutcome": { /* what was expected */ },
    "actualOutcome": { /* what was achieved */ },
    "diffs": [ /* applied changes */ ]
  }
}
```

#### 7. VerificationReport (Verifier → Supervisor)
```javascript
{
  "type": "VerificationReport",
  "from": "verifier",
  "to": "supervisor",
  "timestamp": "2026-04-06T22:00:00Z",
  "correlationId": "uuid-v4",
  "payload": {
    "status": "pass|fail|warning",
    "stepId": "step-1",
    "checks": [
      {
        "name": "Check name",
        "status": "pass|fail",
        "message": "Check result message"
      }
    ],
    "issues": [],
    "recommendations": []
  }
}
```

## State Management

### Workflow State
```javascript
{
  "workflowId": "workflow-uuid",
  "goal": "User goal",
  "status": "planning|executing|verifying|completed|failed|paused",
  "plan": { /* current plan */ },
  "currentStep": "step-id",
  "completedSteps": ["step-1", "step-2"],
  "failedSteps": [],
  "executionLog": [],
  "startTime": "2026-04-06T22:00:00Z",
  "endTime": null,
  "metrics": {
    "totalSteps": 5,
    "completedSteps": 2,
    "totalDuration": "10m",
    "averageStepDuration": "5m"
  }
}
```

## Error Handling

### Error Types
- `PlanError`: Unable to generate a viable plan
- `ExecutionError`: Step execution failed
- `VerificationError`: Verification checks failed
- `SystemError`: Infrastructure or resource issues

### Retry Strategy
- Execution failures: Up to 3 retries with exponential backoff
- Verification failures: Return to worker with feedback
- Plan failures: Request new plan with adjusted constraints

## Concurrency

- Steps can execute in parallel if no dependencies
- Supervisor manages parallel execution limits
- Each agent can handle multiple concurrent requests

## Windows Compatibility

- Use forward slashes for paths internally
- Handle Windows path separators when interacting with OS
- Use cross-platform file system operations
- Avoid OS-specific commands

## Security

- Validate all message payloads
- Sanitize file paths before operations
- Restrict tool access to authorized operations
- Log all agent interactions

## Extensibility

- New agent types can be added by implementing the protocol
- Custom message types can be added for specialized workflows
- Engine provides plugin system for new tools and skills
