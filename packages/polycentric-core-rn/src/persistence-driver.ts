import * as AbstractLevel from 'abstract-level';
import * as MemoryLevel from 'memory-level';
import * as LevelTranscoder from 'level-transcoder';
import { MMKV } from 'react-native-mmkv';

export type BinaryAbstractLevel = AbstractLevel.AbstractLevel<
  Uint8Array,
  Uint8Array,
  Uint8Array
>;

export type BinaryAbstractSubLevel = AbstractLevel.AbstractSublevel<
  BinaryAbstractLevel,
  Uint8Array,
  Uint8Array,
  Uint8Array
>;

export type BinaryPutLevel = AbstractLevel.AbstractBatchPutOperation<
  BinaryAbstractLevel,
  Uint8Array,
  Uint8Array
>;

export type BinaryDelLevel = AbstractLevel.AbstractBatchDelOperation<
  BinaryAbstractLevel,
  Uint8Array
>;

export type BinaryUpdateLevel = BinaryPutLevel | BinaryDelLevel;

export function deepCopyTranscoder(): LevelTranscoder.IEncoding<
  Uint8Array,
  Uint8Array,
  Uint8Array
> {
  return {
    name: 'deepCopyTranscoder',
    format: 'buffer',
    encode: (input: Uint8Array): Uint8Array => {
      const outputBuffer = new ArrayBuffer(input.length);
      const output = new Uint8Array(outputBuffer);
      output.set(input);
      return output;
    },
    decode: (buffer: Uint8Array): Uint8Array => {
      return buffer;
    },
  };
}

export async function tryLoadKey(
  table: BinaryAbstractLevel,
  key: Uint8Array,
): Promise<Uint8Array | undefined> {
  try {
    return await table.get(key);
  } catch (err) {
    return undefined;
  }
}

export interface StorageEstimate {
  bytesAvailable: number | undefined;
  bytesUsed: number | undefined;
}

export interface IPersistenceDriver {
  getImplementationName: () => string;

  openStore: (path: string) => Promise<BinaryAbstractLevel>;

  estimateStorage: () => Promise<StorageEstimate>;

  persisted: () => Promise<boolean>;

  destroyStore: (path: string) => Promise<void>;
}

export function createPersistenceDriverMemory(): IPersistenceDriver {
  const getImplementationName = () => {
    return 'Memory';
  };

  /* eslint @typescript-eslint/require-await: 0 */
  const openStore = async () => {
    return new MemoryLevel.MemoryLevel<Uint8Array, Uint8Array>({
      keyEncoding: deepCopyTranscoder(),
      valueEncoding: deepCopyTranscoder(),
    }) as BinaryAbstractLevel;
  };

  /* eslint @typescript-eslint/require-await: 0 */
  const estimateStorage = async () => {
    return {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };
  };

  /* eslint @typescript-eslint/require-await: 0 */
  const persisted = async () => {
    return false;
  };

  /* eslint @typescript-eslint/no-empty-function: 0 */
  const destroyStore = async () => {};

  return {
    getImplementationName: getImplementationName,
    openStore: openStore,
    estimateStorage: estimateStorage,
    persisted: persisted,
    destroyStore: destroyStore,
  };
}

// React Native MMKV Abstract Level implementation
class MMKVAbstractLevel extends AbstractLevel.AbstractLevel<
  Uint8Array,
  Uint8Array,
  Uint8Array
> {
  private mmkv: MMKV;
  private readonly prefix: string;
  private readonly iterators: Map<number, {
    keys: string[];
    currentIndex: number;
    limit?: number;
    reverse: boolean;
  }> = new Map();
  private nextIteratorId = 1;

  constructor(prefix: string) {
    super({
      encodings: {
        keyEncoding: deepCopyTranscoder(),
        valueEncoding: deepCopyTranscoder()
      }
    });
    this.prefix = prefix;
    this.mmkv = new MMKV({ id: prefix });
  }

  // Required abstract method implementation for AbstractLevel
  async _get(key: Uint8Array): Promise<Uint8Array> {
    const keyStr = this.encodeKey(key);
    const valueStr = this.mmkv.getString(keyStr);
    
    if (valueStr === undefined || valueStr === null) {
      const err: any = new Error('NotFound');
      err.code = 'LEVEL_NOT_FOUND';
      err.notFound = true;
      throw err;
    }

    return this.decodeValue(valueStr);
  }

  // Required abstract method implementation for AbstractLevel
  async _put(key: Uint8Array, value: Uint8Array): Promise<void> {
    const keyStr = this.encodeKey(key);
    const valueStr = this.encodeValue(value);
    this.mmkv.set(keyStr, valueStr);
  }

  // Required abstract method implementation for AbstractLevel
  async _del(key: Uint8Array): Promise<void> {
    const keyStr = this.encodeKey(key);
    this.mmkv.delete(keyStr);
  }

  // Required abstract method implementation for AbstractLevel
  async _batch(operations: Array<AbstractLevel.AbstractBatchOperation<this, Uint8Array, Uint8Array>>): Promise<void> {
    for (const op of operations) {
      if (op.type === 'put') {
        await this._put(op.key, op.value);
      } else if (op.type === 'del') {
        await this._del(op.key);
      }
    }
  }

  // Required for iterator support
  async _keys(options: AbstractLevel.AbstractIteratorOptions<this, Uint8Array>): Promise<AsyncIterator<Uint8Array>> {
    const keys = this.getFilteredKeys(options);
    const iteratorId = this.nextIteratorId++;
    
    this.iterators.set(iteratorId, {
      keys,
      currentIndex: 0,
      limit: options.limit,
      reverse: options.reverse || false
    });

    const self = this;
    
    return {
      async next(): Promise<IteratorResult<Uint8Array>> {
        const iterator = self.iterators.get(iteratorId);
        if (!iterator) {
          return { done: true, value: undefined };
        }

        if (iterator.currentIndex >= iterator.keys.length || 
            (iterator.limit !== undefined && iterator.currentIndex >= iterator.limit)) {
          self.iterators.delete(iteratorId);
          return { done: true, value: undefined };
        }

        const keyStr = iterator.keys[iterator.currentIndex++];
        return { 
          done: false, 
          value: self.decodeKey(keyStr)
        };
      }
    };
  }

  // Required for iterator support
  async _values(options: AbstractLevel.AbstractIteratorOptions<this, Uint8Array>): Promise<AsyncIterator<Uint8Array>> {
    const keys = this.getFilteredKeys(options);
    const iteratorId = this.nextIteratorId++;
    
    this.iterators.set(iteratorId, {
      keys,
      currentIndex: 0,
      limit: options.limit,
      reverse: options.reverse || false
    });

    const self = this;
    
    return {
      async next(): Promise<IteratorResult<Uint8Array>> {
        const iterator = self.iterators.get(iteratorId);
        if (!iterator) {
          return { done: true, value: undefined };
        }

        if (iterator.currentIndex >= iterator.keys.length || 
            (iterator.limit !== undefined && iterator.currentIndex >= iterator.limit)) {
          self.iterators.delete(iteratorId);
          return { done: true, value: undefined };
        }

        const keyStr = iterator.keys[iterator.currentIndex++];
        const valueStr = self.mmkv.getString(keyStr);
        if (valueStr === undefined || valueStr === null) {
          return { done: false, value: new Uint8Array(0) };
        }
        return { 
          done: false, 
          value: self.decodeValue(valueStr)
        };
      }
    };
  }

  // Required for iterator support
  async _iterator(options: AbstractLevel.AbstractIteratorOptions<this, Uint8Array>): Promise<AsyncIterator<[Uint8Array, Uint8Array]>> {
    const keys = this.getFilteredKeys(options);
    const iteratorId = this.nextIteratorId++;
    
    this.iterators.set(iteratorId, {
      keys,
      currentIndex: 0,
      limit: options.limit,
      reverse: options.reverse || false
    });

    const self = this;
    
    return {
      async next(): Promise<IteratorResult<[Uint8Array, Uint8Array]>> {
        const iterator = self.iterators.get(iteratorId);
        if (!iterator) {
          return { done: true, value: undefined };
        }

        if (iterator.currentIndex >= iterator.keys.length || 
            (iterator.limit !== undefined && iterator.currentIndex >= iterator.limit)) {
          self.iterators.delete(iteratorId);
          return { done: true, value: undefined };
        }

        const keyStr = iterator.keys[iterator.currentIndex++];
        const valueStr = self.mmkv.getString(keyStr);
        if (valueStr === undefined || valueStr === null) {
          return { 
            done: false, 
            value: [self.decodeKey(keyStr), new Uint8Array(0)]
          };
        }
        return { 
          done: false, 
          value: [self.decodeKey(keyStr), self.decodeValue(valueStr)]
        };
      }
    };
  }

  // Required for sublevel support
  sublevel<K, V>(name: string, options?: AbstractLevel.SubOpts<K, V>): AbstractLevel.AbstractSublevel<this, Uint8Array, Uint8Array, Uint8Array> {
    const subPrefix = `${this.prefix}_${name}`;
    const sublevel = new MMKVAbstractLevel(subPrefix);
    return sublevel as unknown as AbstractLevel.AbstractSublevel<this, Uint8Array, Uint8Array, Uint8Array>;
  }

  // Helper methods for key/value encoding
  private encodeKey(key: Uint8Array): string {
    return Array.from(key).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private decodeKey(keyStr: string): Uint8Array {
    const bytes = new Uint8Array(keyStr.length / 2);
    for (let i = 0; i < keyStr.length; i += 2) {
      bytes[i / 2] = parseInt(keyStr.substring(i, i + 2), 16);
    }
    return bytes;
  }

  private encodeValue(value: Uint8Array): string {
    return Array.from(value).map(byte => byte.toString(16).padStart(2, '0')).join('');
  }

  private decodeValue(valueStr: string): Uint8Array {
    const bytes = new Uint8Array(valueStr.length / 2);
    for (let i = 0; i < valueStr.length; i += 2) {
      bytes[i / 2] = parseInt(valueStr.substring(i, i + 2), 16);
    }
    return bytes;
  }

  // Helper method to get keys based on iterator options
  private getFilteredKeys(options: AbstractLevel.AbstractIteratorOptions<this, Uint8Array>): string[] {
    const allKeys = this.mmkv.getAllKeys();
    
    let filteredKeys = allKeys;
    
    // Filter by range
    if (options.gt !== undefined || options.gte !== undefined || 
        options.lt !== undefined || options.lte !== undefined) {
      
      filteredKeys = filteredKeys.filter(keyStr => {
        const key = this.decodeKey(keyStr);
        
        if (options.gt !== undefined) {
          const gtKey = this.encodeKey(options.gt);
          if (keyStr <= gtKey) return false;
        }
        
        if (options.gte !== undefined) {
          const gteKey = this.encodeKey(options.gte);
          if (keyStr < gteKey) return false;
        }
        
        if (options.lt !== undefined) {
          const ltKey = this.encodeKey(options.lt);
          if (keyStr >= ltKey) return false;
        }
        
        if (options.lte !== undefined) {
          const lteKey = this.encodeKey(options.lte);
          if (keyStr > lteKey) return false;
        }
        
        return true;
      });
    }
    
    // Sort and apply reverse if needed
    filteredKeys.sort();
    if (options.reverse) {
      filteredKeys.reverse();
    }
    
    // Apply limit
    if (options.limit !== undefined && options.limit >= 0) {
      filteredKeys = filteredKeys.slice(0, options.limit);
    }
    
    return filteredKeys;
  }

  // Method to clear all data
  clear(): void {
    this.mmkv.clearAll();
  }
}

export function createPersistenceDriverReactNative(): IPersistenceDriver {
  const getImplementationName = () => {
    return 'ReactNative';
  };

  const openStore = async (path: string) => {
    return new MMKVAbstractLevel(path) as BinaryAbstractLevel;
  };

  const estimateStorage = async () => {
    return {
      bytesAvailable: undefined,
      bytesUsed: undefined,
    };
  };

  const persisted = async () => {
    return true; // MMKV storage is persistent
  };

  const destroyStore = async (path: string) => {
    const store = new MMKVAbstractLevel(path);
    store.clear();
  };

  return {
    getImplementationName,
    openStore,
    estimateStorage,
    persisted,
    destroyStore,
  };
}
