/** Shared response shape: structured, greppable, and explicit about what happened. */
export interface ToolOutcome {
    /** Whether the requested effect was achieved and kept. */
    readonly ok: boolean;
    /** One-line human summary. */
    readonly message: string;
    /** Files touched, with backup ids when a backup was written. */
    readonly files?: readonly FileOutcome[];
    /** Syntax gate verdicts collected before commit. */
    readonly syntax?: readonly SyntaxVerdict[];
    /** Actionable next step when ok is false. */
    readonly next?: string;
}
export interface FileOutcome {
    readonly path: string;
    readonly backupId?: string;
    readonly changed: boolean;
}
export interface SyntaxVerdict {
    readonly path: string;
    readonly status: string;
    readonly checker: string;
    readonly detail?: string;
}
/** Render an outcome as the single text block models consume. */
export declare function renderOutcome(outcome: ToolOutcome): string;
/** Standard output schema for every tool in this toolkit. */
export declare const OUTCOME_SCHEMA: {
    readonly type: "object";
    readonly additionalProperties: false;
    readonly properties: {
        readonly ok: {
            readonly type: "boolean";
            readonly description: "是否成功";
        };
        readonly message: {
            readonly type: "string";
            readonly description: "一句话结果摘要";
        };
        readonly files: {
            readonly type: "array";
            readonly description: "涉及的文件";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly path: {
                        readonly type: "string";
                    };
                    readonly backupId: {
                        readonly type: "string";
                    };
                    readonly changed: {
                        readonly type: "boolean";
                    };
                };
            };
        };
        readonly syntax: {
            readonly type: "array";
            readonly description: "语法门禁结果";
            readonly items: {
                readonly type: "object";
                readonly additionalProperties: false;
                readonly properties: {
                    readonly path: {
                        readonly type: "string";
                    };
                    readonly status: {
                        readonly type: "string";
                    };
                    readonly checker: {
                        readonly type: "string";
                    };
                    readonly detail: {
                        readonly type: "string";
                    };
                };
            };
        };
        readonly next: {
            readonly type: "string";
            readonly description: "失败时的可执行建议";
        };
    };
};
