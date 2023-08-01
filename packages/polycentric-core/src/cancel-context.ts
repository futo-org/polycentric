export class CancelContext {
    private _cancelled: boolean;
    private _callbacks: Array<() => void>;

    public constructor() {
        this._cancelled = false;
        this._callbacks = [];
    }

    public cancelled(): boolean {
        return this._cancelled;
    }

    public cancel(): void {
        if (this._cancelled === false) {
            this._callbacks.map((cb) => cb());
        }

        this._cancelled = true;
    }

    public addCallback(cb: () => void): void {
        this._callbacks.push(cb);
    }
}
