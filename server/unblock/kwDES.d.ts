// kwDES.js 的类型声明，纯 JS 实现不参与 tsc 编译，此处补充接口
export declare const encrypt: (msg: Buffer) => Buffer;
export declare const decrypt: (msg: Buffer) => Buffer;
export declare const encryptQuery: (query: string) => string;
