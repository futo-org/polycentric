export class CancelContext {
    private _cancelled: boolean;
    private readonly _callbacks: Set<() => void>;

    public constructor() {
        this._cancelled = false;
        this._callbacks = new Set();
    }

    public cancelled(): boolean {
        return this._cancelled;
    }

    public cancel(): void {
        if (this._cancelled === false) {
            this._callbacks.forEach((cb) => cb());
        }

        this._cancelled = true;
    }

    public addCallback(cb: () => void): void {
        this._callbacks.add(cb);
    }
}
