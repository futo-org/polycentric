export type ResultError = {
    message: string;
    extendedMessage?: string;
    statusCode?: number;
};

export class Result<T = void> {
    private _success: boolean;
    private _error?: ResultError;
    private _value?: T;

    private constructor(success: boolean, error?: ResultError, value?: T) {
        this._success = success;
        this._error = error;
        this._value = value;
    }

    public get success(): boolean {
        return this._success;
    }

    public get error(): ResultError {
        if (this._error === undefined) {
            throw Error('error is undefined');
        } else {
            return this._error;
        }
    }

    public get value(): T {
        if (this._value === undefined) {
            throw Error('value is undefined');
        } else {
            return this._value;
        }
    }

    static ok<T>(value?: T): Result<T> {
        return new Result<T>(true, undefined, value);
    }

    static err<T>(err: ResultError): Result<T> {
        console.error(`${err.message} (${err.extendedMessage})`);
        return new Result<T>(false, err, undefined);
    }

    static errMsg<T>(errMsg: string): Result<T> {
        console.error(errMsg);
        return new Result<T>(false, { message: errMsg }, undefined);
    }
}
