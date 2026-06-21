'use strict';

/**
 * app.js
 * ------------------------------------------------------------------
 * 前端 Vue 3 单页应用（createApp + {{ }} 模板，逻辑写在 methods/data）。
 * 通过 fetch 调用后端 REST 接口，完成「打卡 / 今日 / 历史 / 统计」闭环。
 * ------------------------------------------------------------------
 */

const { createApp } = Vue;

createApp({
  data() {
    // 把今天日期格式化为 YYYY-MM-DD，作为打卡表单默认日期
    const d = new Date();
    const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    return {
      // 当前 tab：home / add / history / stats
      tab: 'home',
      // 全部打卡记录
      checkins: [],
      // 统计数据
      stats: {
        todayCount: 0, todayMinutes: 0, streak: 0, weekTotal: 0,
        weekDays: [], totalCount: 0, totalMinutes: 0, sportStats: []
      },
      // 可选运动类型（名称 + emoji 图标）
      sports: [
        { name: '跑步', icon: '🏃' },
        { name: '骑行', icon: '🚴' },
        { name: '游泳', icon: '🏊' },
        { name: '健身房', icon: '🏋️' },
        { name: '瑜伽', icon: '🧘' },
        { name: '球类', icon: '🏀' },
        { name: '步行', icon: '🚶' }
      ],
      // 强度选项
      intensities: ['轻松', '适中', '高强度'],
      // 打卡表单
      form: { sport: '跑步', minutes: 30, intensity: '适中', note: '', date: today },
      // 表单提示文字
      tip: ''
    };
  },

  computed: {
    // 顶部标题随 tab 变化
    tabTitle() {
      return { home: '健身打卡', add: '记录打卡', history: '历史记录', stats: '数据统计' }[this.tab] || '健身打卡';
    },
    // 首页最近打卡：取前 5 条
    recent() {
      return this.checkins.slice(0, 5);
    }
  },

  methods: {
    // 切换 tab
    go(tab) {
      this.tab = tab;
      this.tip = '';
    },

    // 根据运动名返回 emoji 图标
    sportIcon(name) {
      const s = this.sports.find((x) => x.name === name);
      return s ? s.icon : '🏅';
    },

    // 强度 -> 颜色样式类名
    intensityClass(lv) {
      return { '轻松': 'lv-easy', '适中': 'lv-mid', '高强度': 'lv-hard' }[lv] || 'lv-mid';
    },

    // 柱状图：把分钟数换算成柱子高度百分比（以本周最大值为 100%）
    barHeight(minutes) {
      const max = Math.max(1, ...this.stats.weekDays.map((d) => d.minutes || 0));
      const pct = Math.round(((minutes || 0) / max) * 100);
      return Math.max(2, pct) + '%';
    },

    // 拉取全部打卡记录
    async loadCheckins() {
      const res = await fetch('/api/checkins');
      this.checkins = await res.json();
    },

    // 拉取统计数据
    async loadStats() {
      const res = await fetch('/api/stats');
      this.stats = await res.json();
    },

    // 同时刷新列表 + 统计
    async refresh() {
      await Promise.all([this.loadCheckins(), this.loadStats()]);
    },

    // 提交一条新打卡
    async submit() {
      if (!(this.form.minutes > 0)) {
        this.tip = '请填写有效的运动时长';
        return;
      }
      const res = await fetch('/api/checkins', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(this.form)
      });
      if (res.ok) {
        await this.refresh();
        // 重置备注与时长，回到首页查看结果
        this.tip = '打卡成功！';
        this.form.note = '';
        setTimeout(() => { this.go('home'); }, 600);
      } else {
        const err = await res.json().catch(() => ({}));
        this.tip = err.error || '打卡失败，请重试';
      }
    },

    // 删除一条打卡
    async del(id) {
      const res = await fetch('/api/checkins/' + id, { method: 'DELETE' });
      if (res.ok) await this.refresh();
    }
  },

  // 应用挂载后立即加载数据
  mounted() {
    this.refresh();
  }
}).mount('#app');
