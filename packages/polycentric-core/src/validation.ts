import * as Protocol from './protocol';

function validatePublicKey(key: Uint8Array): boolean {
    if (key.length !== 32) {
        console.log('invalid public key length', key);

        return false;
    }

    return true;
}

export function validateEvent(event: Protocol.Event): boolean {
    if (event.writerId.length !== 32) {
        console.log('invalid writerId length', event.writerId.length);

        return false;
    }

    if (validatePublicKey(event.authorPublicKey) === false) {
        return false;
    }

    if (event.signature === undefined) {
        console.log('signature not found');

        return false;
    }

    if (event.signature.length !== 64) {
        console.log('invalid signature length', event.signature.length);

        return false;
    }

    for (const clock of event.clocks) {
        if (clock.key.length !== 32) {
            console.log('invalid clock key length', clock.key.length);

            return false;
        }
    }

    return true;
}

function validatePointer(pointer: Protocol.Pointer): boolean {
    if (pointer.writerId.length !== 32) {
        console.log('invalid writerId length', pointer.writerId.length);

        return false;
    }

    if (validatePublicKey(pointer.publicKey) === false) {
        return false;
    }

    return true;
}

export function validateEventBody(event: Protocol.EventBody): boolean {
    if (event.message !== undefined) {
        if (event.message.image !== undefined) {
            if (validatePointer(event.message.image) === false) {
                return false;
            }
        }

        if (event.message.boostPointer !== undefined) {
            if (validatePointer(event.message.boostPointer) === false) {
                return false;
            }
        }
    } else if (event.profile !== undefined) {
        if (event.profile.profileImagePointer !== undefined) {
            if (validatePointer(event.profile.profileImagePointer) === false) {
                return false;
            }
        }
    } else if (event.follow !== undefined) {
        if (validatePublicKey(event.follow.publicKey) === false) {
            return false;
        }
    } else if (event.delete !== undefined) {
        if (validatePointer(event.delete.pointer!) === false) {
            return false;
        }
    }

    return true;
}
