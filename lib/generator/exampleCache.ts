/* tslint:disable:max-classes-per-file */
interface BaseCache {
  get(modelName:string):CacheItem|undefined
  set(modelName: string, example: CacheItem):void
  has(modelName: string):boolean
}
export class MockerCache implements BaseCache {
  private caches = new Map<string, CacheItem>();

  public get(modelName: string) {
    if (this.has(modelName)) {
      return this.caches.get(modelName);
    }
    return undefined;
  }
  public set(modelName: string, example: CacheItem) {
    if (!this.has(modelName)) {
      this.caches.set(modelName, example);
    }
  }
  public has(modelName: string) {
    return this.caches.has(modelName);
  }
  public checkAndCache(schema: any, example: CacheItem) {
    if (!schema || !example) {
      return;
    }
    if ("$ref" in schema && !this.has(schema.$ref.split("#")[1])) {
      this.caches.set(schema.$ref.split("#")[1], example);
    }
  }
}
export class PayloadCache implements BaseCache {
  private requestCaches = new Map<string, CacheItem>();
  private responseCaches = new Map<string, CacheItem>();
  private mergedCaches = new Map<string, CacheItem>();

  private hasByDirection(modelName: string, isRequest: boolean) {
    const cache = isRequest ? this.requestCaches : this.responseCaches;
    return cache.has(modelName);
  }
  private setByDirection(modelName: string, example: CacheItem, isRequest: boolean) {
    const cache = isRequest ? this.requestCaches : this.responseCaches;
    if (!cache.has(modelName)) {
      cache.set(modelName, example);
    }
  }
  private getByDirection(modelName: string, isRequest: boolean) {
    const cache = isRequest ? this.requestCaches : this.responseCaches;
    if (cache.has(modelName)) {
      return cache.get(modelName);
    }
    return undefined;
  }
  public get(modelName: string) {
    if (this.mergedCaches.has(modelName)) {
      return this.mergedCaches.get(modelName);
    }
    return undefined;
  }

  public set(key: string, value: CacheItem) {
    if (!this.mergedCaches.has(key)) {
      this.mergedCaches.set(key, value);
    }
  }

  public has(modelName: string) {
    return this.mergedCaches.has(modelName);
  }

  public checkAndCache(schema: any, example: CacheItem, isRequest: boolean) {
    if (!schema || !example) {
      return;
    }
    if ("$ref" in schema && !this.hasByDirection(schema.$ref.split("#")[1], isRequest)) {
      this.setByDirection(schema.$ref.split("#")[1], example, isRequest);
    }
  }
  /**
   *
   * @param target The target item that to be merged into
   * @param source The source item that needs to merge
   */
  public mergeItem(target: CacheItem, source: CacheItem): CacheItem {
    const result = target;
    if (Array.isArray(result.child) && Array.isArray(source.child)) {
      if (result.child.length < source.child.length) {
        result.child = (result.child as CacheItem[]).concat(
          source.child.slice(result.child.length)
        );
      }
    } else if (source.child && result.child) {
      const resultObj = result.child as CacheItemObject;
      const sourceObj = source.child as CacheItemObject;
      for (const key of Object.keys(sourceObj)) {
        if (!resultObj[key]) {
          resultObj[key] = sourceObj[key];
        } else {
          resultObj[key] = this.mergeItem(resultObj[key], sourceObj[key]);
        }
      }
    }
    return result;
  }

  /**
   * 1 for each request cache , if exists in response cache, merge it with response cache and put into merged cache .
   * 2 for each response cache, if not exists in merged cache, then put into merged cache.
   */
  public mergeCache() {
    for (const [key, requestCache] of this.requestCaches.entries()) {
      if (this.hasByDirection(key, false) && !requestCache.isLeaf) {
        const responseCache = this.getByDirection(key, false);
        if (responseCache) {
          if (responseCache.isLeaf) {
            console.error(`The response cache and request cache is inconsistent! key:${key}`);
          } else {
            const mergedCache = this.mergeItem(requestCache, responseCache);
            this.set(key, mergedCache);
            continue;
          }
        }
      }
      this.set(key, requestCache);
    }
    for (const [key, responseCache] of this.responseCaches.entries()) {
      if (!this.hasByDirection(key, true)) {
        this.set(key, responseCache);
      }
    }
    this.requestCaches.clear();
    this.responseCaches.clear();
  }

}

const shouldSkip = (cache: CacheItem | undefined, isRequest: boolean) => {
  return (isRequest && cache?.options?.isReadonly) || (!isRequest && cache?.options?.isXmsSecret);
};

export const reBuildExample = (cache: CacheItem | undefined, isRequest: boolean): any => {
  if (!cache) {
    return undefined;
  }
  if (shouldSkip(cache, isRequest)) {
    return undefined;
  }
  if (cache.isLeaf) {
    return cache.value;
  }
  if (Array.isArray(cache.child)) {
    const result = [];
    for (const item of cache.child) {
      if (shouldSkip(cache, isRequest)) {
        continue;
      }
      result.push(reBuildExample(item, isRequest));
    }
    return result;
  } else if (cache.child) {
    const result: any = {};
    for (const key of Object.keys(cache.child)) {
      if (shouldSkip(cache, isRequest)) {
        continue;
      }
      const value = reBuildExample(cache.child[key], isRequest);
      if (value !== undefined) {
        result[key] = value;
      }
    }
    return result;
  }
  return undefined;
};

type CacheItemValue = string | number | object;
interface CacheItemObject {
  [index: string]: CacheItem;
}
type CacheItemChild = CacheItemObject | CacheItem[];
interface CacheItemOptions {
  isReadonly?: boolean;
  isXmsSecret?: boolean;
}
export interface CacheItem {
  value?: CacheItemValue;
  child?: CacheItemChild;
  options?: CacheItemOptions;
  isLeaf: boolean;
  required?: string[];
}

export const buildItemOption = (schema: any) => {
  if (schema) {
    const isReadonly = !!schema.readOnly;
    const isXmsSecret = !!schema["x-ms-secret"];
    if (!isReadonly && !isXmsSecret) {
      return undefined;
    }
    let option: CacheItemOptions = {};
    if (isReadonly) {
      option = { isReadonly: true };
    }
    if (isXmsSecret) {
      option = { ...option, isXmsSecret: true };
    }
    return option;
  }
  return undefined;
};

export const createLeafItem = (
  itemValue: CacheItemValue,
  option: CacheItemOptions | undefined = undefined
): CacheItem => {
  const item = {
    isLeaf: true,
    value: itemValue,
  } as CacheItem;
  if (option) {
    item.options = option;
  }
  return item;
};

export const createTrunkItem = (
  itemValue: CacheItemChild,
  option: CacheItemOptions | undefined
): CacheItem => {
  const item = {
    isLeaf: false,
    child: itemValue,
  } as CacheItem;
  if (option) {
    item.options = option;
  }
  return item;
};
