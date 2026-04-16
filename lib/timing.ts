/**
 * 计时记录工具
 * 统一管理多个计时器，支持记录耗时、计数、汇总输出
 */

export interface TimingRecord {
  name: string;
  startTime: number;
  endTime?: number;
  duration?: number;
}

export interface TimingLoggerOptions {
  prefix: string;
}

export class TimingLogger {
  protected records: TimingRecord[] = [];
  protected currentRecord: TimingRecord | null = null;
  protected counters: Map<string, number> = new Map();
  protected prefix: string;

  constructor(options: TimingLoggerOptions) {
    this.prefix = options.prefix;
  }

  start(name: string): void {
    const startTime = performance.now();
    this.currentRecord = { name, startTime };
    this.records.push(this.currentRecord);
    console.log(`${this.prefix} ⏱️ 开始: ${name}`);
  }

  end(name: string): number {
    const endTime = performance.now();
    const record = this.records.find(r => r.name === name && !r.endTime) || this.currentRecord;

    if (record && record.name === name) {
      record.endTime = endTime;
      record.duration = endTime - record.startTime;
      console.log(`${this.prefix} ⏱️ 完成: ${name} - 耗时: ${record.duration.toFixed(2)}ms`);
      this.currentRecord = null;
      return record.duration;
    }

    console.warn(`${this.prefix} ⚠️ 未找到匹配的计时记录: ${name}`);
    return 0;
  }

  log(name: string, duration: number): void {
    console.log(`${this.prefix} ⏱️ ${name}: ${duration.toFixed(2)}ms`);
  }

  increment(name: string): number {
    const count = (this.counters.get(name) || 0) + 1;
    this.counters.set(name, count);
    return count;
  }

  getCount(name: string): number {
    return this.counters.get(name) || 0;
  }

  reset(): void {
    this.records = [];
    this.currentRecord = null;
    this.counters.clear();
  }

  summary(): void {
    console.log(`\n========== ${this.prefix} 执行时间汇总 ==========`);
    let total = 0;
    this.records.forEach(r => {
      if (r.duration) {
        console.log(`  ${r.name}: ${r.duration.toFixed(2)}ms`);
        total += r.duration;
      }
    });
    console.log(`  总计: ${total.toFixed(2)}ms`);
    console.log('各操作调用次数:');
    this.counters.forEach((count, name) => {
      console.log(`  ${name}: ${count} 次`);
    });
    console.log('=============================================\n');
  }
}

// 预设实例（兼容旧代码直接引用）
export const timing = new TimingLogger({ prefix: '[传统方案]' });
export const timingWorker = new TimingLogger({ prefix: '[Worker优化方案]' });
export const timingV3 = new TimingLogger({ prefix: '[Worker V3 实验方案]' });
