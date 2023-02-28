export class CancelContext {
    private _cancelled: boolean;

    public constructor() {
        this._cancelled = false;
    }

    public cancelled(): boolean {
        return this._cancelled;
    }

    public cancel(): void {
        this._cancelled = true;
    }
}

