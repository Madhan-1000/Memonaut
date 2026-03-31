declare module 'better-sqlite3' {
  interface Statement {
    run(...args: any[]): any
    all<T = any>(...args: any[]): T[]
  }

  interface DatabaseOptions {
    readonly?: boolean
    fileMustExist?: boolean
    timeout?: number
    verbose?: (...params: any[]) => void
  }

  interface Pragmas {
    journal_mode?: string
    foreign_keys?: boolean | string
  }

  class Database {
    constructor(path: string, options?: DatabaseOptions)
    prepare(sql: string): Statement
    pragma(text: string, options?: { simple?: boolean }): any
    transaction<T extends (...args: any[]) => any>(fn: T): T
    close(): void
  }

  export = Database
}