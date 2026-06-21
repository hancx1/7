'use strict';

/**
 * store.js
 * ------------------------------------------------------------------
 * 数据持久化层：class JsonStore
 * 负责把「打卡记录」读写到本地 JSON 文件（data.json）。
 * 不依赖任何数据库 / 第三方库，仅用 Node 内置 fs / path 模块。
 * ------------------------------------------------------------------
 */

const fs = require('node:fs');
const path = require('node:path');

/**
 * JsonStore —— 基于 JSON 文件的简易数据存储
 * 数据结构： { checkins: [ { id, sport, minutes, intensity, note, date, created_at } ] }
 */
class JsonStore {
  /**
   * @param {string} file data.json 的绝对路径
   */
  constructor(file) {
    this.file = file;
    // 内存中缓存的数据对象
    this.data = { checkins: [] };
    // 自增 id 计数器
    this._seq = 1;
    this._init();
  }

  /**
   * 初始化：文件存在则读取，不存在则写入示例数据。
   */
  _init() {
    if (fs.existsSync(this.file)) {
      this._load();
    } else {
      // 首次运行：生成 6-8 条示例打卡数据，分布在最近一周不同日期
      this.data = { checkins: this._seedData() };
      this._recalcSeq();
      this._save();
    }
  }

  /**
   * 从磁盘读取 JSON 到内存。
   */
  _load() {
    try {
      const raw = fs.readFileSync(this.file, 'utf8');
      const obj = JSON.parse(raw);
      // 兼容性处理：保证 checkins 一定是数组
      this.data = { checkins: Array.isArray(obj.checkins) ? obj.checkins : [] };
      this._recalcSeq();
    } catch (e) {
      // 文件损坏时退回空数据，避免服务崩溃
      console.error('读取 data.json 失败，使用空数据：', e.message);
      this.data = { checkins: [] };
      this._seq = 1;
    }
  }

  /**
   * 把内存数据写回磁盘（同步写，保证课程演示时数据立即落盘）。
   */
  _save() {
    fs.writeFileSync(this.file, JSON.stringify(this.data, null, 2), 'utf8');
  }

  /**
   * 根据现有记录里最大的 id 重新计算自增序号，避免 id 冲突。
   */
  _recalcSeq() {
    const maxId = this.data.checkins.reduce((m, c) => Math.max(m, Number(c.id) || 0), 0);
    this._seq = maxId + 1;
  }

  /**
   * 工具：把 Date 对象格式化成 YYYY-MM-DD（本地时区）。
   */
  static fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  /**
   * 生成示例数据：覆盖最近一周内的不同日期，方便演示与截图。
   */
  _seedData() {
    const today = new Date();
    // 偏移天数对应「今天/昨天/前天 ...」，制造连续打卡的效果
    const make = (offset, sport, minutes, intensity, note) => {
      const d = new Date(today);
      d.setDate(today.getDate() - offset);
      const date = JsonStore.fmtDate(d);
      return {
        sport, minutes, intensity, note,
        date,
        created_at: d.toISOString()
      };
    };
    const seeds = [
      make(0, '跑步', 35, '适中', '晨跑环湖一圈'),
      make(0, '健身房', 50, '高强度', '胸 + 三头训练'),
      make(1, '骑行', 60, '适中', '通勤往返'),
      make(2, '游泳', 40, '高强度', '自由泳 1000m'),
      make(3, '瑜伽', 45, '轻松', '睡前拉伸放松'),
      make(4, '球类', 70, '高强度', '周末打篮球'),
      make(5, '步行', 30, '轻松', '饭后散步'),
      make(6, '跑步', 25, '适中', '操场五公里')
    ];
    // 统一补上自增 id
    return seeds.map((s, i) => Object.assign({ id: i + 1 }, s));
  }

  // ============ 对外的业务方法 ============

  /**
   * 返回全部打卡记录（按日期 + 创建时间倒序，最新的在前）。
   */
  list() {
    return [...this.data.checkins].sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }

  /**
   * 新增一条打卡记录。
   * @param {object} input { sport, minutes, intensity, note, date }
   * @returns {object} 新建的完整记录
   */
  add(input) {
    const now = new Date();
    const item = {
      id: this._seq++,
      sport: String(input.sport || '跑步'),
      minutes: Math.max(0, parseInt(input.minutes, 10) || 0),
      intensity: String(input.intensity || '适中'),
      note: String(input.note || ''),
      // 未传日期则默认今天
      date: input.date ? String(input.date) : JsonStore.fmtDate(now),
      created_at: now.toISOString()
    };
    this.data.checkins.push(item);
    this._save();
    return item;
  }

  /**
   * 按 id 删除一条记录。
   * @returns {boolean} 是否删除成功
   */
  remove(id) {
    const before = this.data.checkins.length;
    this.data.checkins = this.data.checkins.filter((c) => Number(c.id) !== Number(id));
    const changed = this.data.checkins.length !== before;
    if (changed) this._save();
    return changed;
  }

  /**
   * 统计数据：连续打卡天数、今日数据、本周每天时长、运动类型占比等。
   * @returns {object} 供前端首页 + 统计页使用
   */
  stats() {
    const list = this.data.checkins;
    const today = new Date();
    const todayStr = JsonStore.fmtDate(today);

    // 所有打卡过的日期集合（去重）
    const dateSet = new Set(list.map((c) => c.date));

    // ---- 连续打卡天数 streak：从今天往前逐天检查是否有打卡 ----
    let streak = 0;
    const cursor = new Date(today);
    // 若今天还没打卡，则从昨天开始算 streak（今天不打断连续）
    if (!dateSet.has(JsonStore.fmtDate(cursor))) {
      cursor.setDate(cursor.getDate() - 1);
    }
    while (dateSet.has(JsonStore.fmtDate(cursor))) {
      streak++;
      cursor.setDate(cursor.getDate() - 1);
    }

    // ---- 今日数据：打卡次数 + 总时长 ----
    const todayList = list.filter((c) => c.date === todayStr);
    const todayCount = todayList.length;
    const todayMinutes = todayList.reduce((s, c) => s + (c.minutes || 0), 0);

    // ---- 本周每天时长（周一为一周起点） ----
    // 计算本周一的日期
    const weekStart = new Date(today);
    const dow = (today.getDay() + 6) % 7; // 周一=0 ... 周日=6
    weekStart.setDate(today.getDate() - dow);
    const weekDays = [];
    let weekTotal = 0;
    for (let i = 0; i < 7; i++) {
      const d = new Date(weekStart);
      d.setDate(weekStart.getDate() + i);
      const ds = JsonStore.fmtDate(d);
      const minutes = list
        .filter((c) => c.date === ds)
        .reduce((s, c) => s + (c.minutes || 0), 0);
      weekTotal += minutes;
      const labels = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
      weekDays.push({ date: ds, label: labels[i], minutes });
    }

    // ---- 各运动类型时长占比 ----
    const sportMap = {};
    let totalMinutes = 0;
    list.forEach((c) => {
      sportMap[c.sport] = (sportMap[c.sport] || 0) + (c.minutes || 0);
      totalMinutes += c.minutes || 0;
    });
    const sportStats = Object.keys(sportMap)
      .map((sport) => ({
        sport,
        minutes: sportMap[sport],
        // 百分比保留一位小数
        percent: totalMinutes ? Math.round((sportMap[sport] / totalMinutes) * 1000) / 10 : 0
      }))
      .sort((a, b) => b.minutes - a.minutes);

    return {
      todayCount,
      todayMinutes,
      streak,
      weekTotal,
      weekDays,
      totalCount: list.length,
      totalMinutes,
      sportStats
    };
  }
}

module.exports = JsonStore;
