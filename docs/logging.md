# Logging System Documentation

## Overview

The Nopo project implements comprehensive structured logging across all layers of the application with support for multiple log levels and configurable output formats.

## Backend Logging (Django)

### Configuration

The Django backend uses Python's built-in `logging` module with structured JSON logging support via `python-json-logger`.

**Location:** `apps/backend/settings.py`

### Log Levels

The backend supports standard Python logging levels:
- **DEBUG**: Detailed diagnostic information
- **INFO**: General informational messages
- **WARNING**: Warning messages for potentially harmful situations
- **ERROR**: Error messages for serious problems
- **CRITICAL**: Critical messages for very serious errors

### Environment Variables

Control log levels via environment variables:
- `LOG_LEVEL`: Root logger level (default: INFO)
- `DJANGO_LOG_LEVEL`: Django framework logger level (default: INFO)
- `BACKEND_LOG_LEVEL`: Backend application logger level (default: INFO)

### Formatters

Three formatters are available:

1. **verbose**: Human-readable format with timestamp, module, process/thread IDs
2. **simple**: Basic format with level and message
3. **json**: Structured JSON format for machine parsing

### Handlers

- **console**: Standard console output with verbose formatting
- **json_console**: Console output with JSON formatting for the backend logger

### Usage

Import and use the logging utilities:

```python
from backend.logging_utils import log_debug, log_info, log_warning, log_error, log_exception

# Simple logging
log_info("User logged in")

# Structured logging with context
log_info("User logged in", user_id=123, ip_address="192.168.1.1")

# Error logging
log_error("Failed to process payment", order_id=456, error_code="PAYMENT_FAILED")

# Exception logging (includes traceback)
try:
    risky_operation()
except Exception:
    log_exception("Operation failed", operation="risky_operation")
```

### Example Output

**Verbose format (console):**
```
INFO 2026-02-06 12:34:56,789 views 1234 5678 Todo item created successfully
```

**JSON format (json_console):**
```json
{
  "asctime": "2026-02-06 12:34:56,789",
  "name": "backend",
  "levelname": "INFO",
  "message": "Todo item created successfully",
  "todo_id": 42,
  "title": "Implement feature X",
  "priority": "high"
}
```

## Frontend Logging (TypeScript)

### Location

`packages/ui/src/lib/logger.ts`

### Log Levels

Four log levels with priority hierarchy:
- **debug**: Detailed debugging information
- **info**: General informational messages
- **warn**: Warning messages
- **error**: Error messages

### Usage

```typescript
import { log, info, warn, error, setLogLevel } from '@more/ui/lib/logger';

// Set log level (filters out lower priority logs)
setLogLevel('info'); // Only info, warn, error will be logged

// Logging
log('Debug information'); // Won't be logged if level is 'info'
info('Application started');
warn('API response slow', { duration: 1500 });
error('Failed to fetch data', { endpoint: '/api/users' });
```

### Features

- **Level filtering**: Only logs at or above the current level are output
- **Multiple arguments**: Supports multiple arguments like native console methods
- **Type-safe**: Full TypeScript support with type definitions

## CLI Logging

### Location

`nopo/scripts/src/lib.ts`

### Features

- **Colored output**: Uses custom chalk implementation for colored terminal output
- **Silent mode**: Respects `silent` config flag
- **NO_COLOR support**: Automatically disables colors when NO_COLOR environment variable is set
- **Process logging**: Prefixed logging for child processes

### Usage

```typescript
const logger = new Logger(config);
logger.log(logger.chalk.green('Success!'));
logger.log(logger.chalk.yellow('Warning:'), 'Something might be wrong');
logger.log(logger.chalk.red('Error:'), 'Operation failed');
```

## GitHub Actions Logging

### Location

`.github/actions-ts/*/index.ts`

### Usage

Uses the `@actions/core` module:

```typescript
import * as core from '@actions/core';

core.info('Informational message');
core.debug('Debug message');
core.warning('Warning message');
core.error('Error message');
```

## Best Practices

### When to Log

**DO log:**
- Important state changes (user created, order placed)
- Error conditions and exceptions
- Performance-critical operations with timing
- External API calls and responses
- Authentication and authorization events

**DON'T log:**
- Sensitive data (passwords, tokens, credit cards)
- Excessive debug information in production
- Every function entry/exit (too noisy)
- Data that's already in database audit logs

### Structured Logging

Always include relevant context:

```python
# Good - structured with context
log_info("Payment processed",
    order_id=order.id,
    amount=order.total,
    payment_method="credit_card"
)

# Bad - unstructured string interpolation
log_info(f"Payment processed for order {order.id} amount {order.total}")
```

### Log Levels

Choose appropriate log levels:

- **DEBUG**: "Variable x = 42", "Entering function process_order"
- **INFO**: "User 123 logged in", "Order 456 created"
- **WARNING**: "API response time 2s (threshold 1s)", "Cache miss rate 50%"
- **ERROR**: "Failed to send email", "Database connection lost"
- **CRITICAL**: "Disk space critical", "Payment gateway unreachable"

### Error Logging

Always log exceptions with context:

```python
try:
    process_payment(order)
except PaymentError as e:
    log_exception(
        "Payment processing failed",
        order_id=order.id,
        user_id=order.user_id,
        payment_method=order.payment_method
    )
    raise
```

## Testing

### Backend Tests

Tests are located in `apps/backend/src/backend/tests/test_logging_utils.py`.

Run tests:
```bash
make test backend
```

### Frontend Tests

Tests are located in `packages/ui/tests/logger.test.ts`.

Run tests:
```bash
nopo test ui
```

## Configuration Examples

### Production Configuration

For production, use JSON logging and INFO level:

```bash
export LOG_LEVEL=INFO
export BACKEND_LOG_LEVEL=INFO
export DJANGO_LOG_LEVEL=WARNING
```

### Development Configuration

For development, use verbose logging and DEBUG level:

```bash
export LOG_LEVEL=DEBUG
export BACKEND_LOG_LEVEL=DEBUG
export DJANGO_LOG_LEVEL=INFO
```

### CI/CD Configuration

For CI/CD, use JSON logging for machine parsing:

```bash
export LOG_LEVEL=INFO
# JSON format is automatically used for the backend logger
```

## Troubleshooting

### No logs appearing

1. Check log level settings - ensure messages meet the threshold
2. Verify logger name matches configuration in settings.py
3. Check that handlers are properly configured

### Logs are too verbose

1. Increase log level (DEBUG → INFO → WARNING → ERROR)
2. Adjust specific logger levels independently
3. Review code for excessive logging

### JSON logs not formatting correctly

1. Verify `python-json-logger` is installed
2. Check that the json formatter is configured in settings.py
3. Ensure the handler uses the json formatter
