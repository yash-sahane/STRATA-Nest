/**
 * Centralized logging utility for L-T-Connect
 * Provides structured logging with different levels
 * Automatically filters debug logs in production
 */

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogContext {
    [key: string]: any;
}

class Logger {
    private isDevelopment = process.env.NODE_ENV === 'development';

    private formatMessage(level: LogLevel, message: string, context?: LogContext): string {
        const timestamp = new Date().toISOString();
        const prefix = `[${timestamp}] [${level.toUpperCase()}]`;

        if (context && Object.keys(context).length > 0) {
            return `${prefix} ${message} ${JSON.stringify(context)}`;
        }

        return `${prefix} ${message}`;
    }

    /**
     * Debug level - only shown in development
     * Use for detailed debugging information
     */
    debug(message: string, context?: LogContext): void {
        if (!this.isDevelopment) return;
        console.debug(this.formatMessage('debug', message, context));
    }

    /**
     * Info level - general information
     * Use for normal application flow
     */
    info(message: string, context?: LogContext): void {
        console.info(this.formatMessage('info', message, context));
    }

    /**
     * Warning level - something unexpected but not critical
     * Use for recoverable errors or deprecation warnings
     */
    warn(message: string, context?: LogContext): void {
        console.warn(this.formatMessage('warn', message, context));
    }

    /**
     * Error level - something went wrong
     * Use for errors that need attention
     */
    error(message: string, context?: LogContext): void {
        console.error(this.formatMessage('error', message, context));
    }
}

// Export singleton instance
export const logger = new Logger();
