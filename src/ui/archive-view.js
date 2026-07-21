(function createArchiveView(global) {
  "use strict";

  function discardPicker(instances, getDef, formatInk, options = {}) {
    const rows = instances.map(instance => {
      const def = getDef(instance);
      return `<label class="archive-choice">
        <input type="checkbox" value="${instance.id}" onchange="toggleArchivePick(${instance.id},this.checked)">
        <span><b>${def.name}</b><small>${def.type} · ${formatInk(def.cost)} 墨水 · 初始等待 ${formatInk(def.cost)} 回合</small></span>
      </label>`;
    }).join("");
    return `<h1>${options.archiving ? "锁定奇点目标" : "超维归档：奇点"}</h1>
      <p>选择1至3张不同名称的弃牌。${options.archiving ? "所选牌会在本牌倒计时结束时才移入归档区。" : "选择顺序同时决定归零后的使用顺序。"}</p>
      <div class="archive-choice-list">${rows||"<p>弃牌堆中没有可归档卡牌。</p>"}</div>
      <p id="archivePickStatus" class="small">已选择 0/3</p>
      <button onclick="confirmArchivePick()" ${instances.length?"":"disabled"}>确认归档</button>
      <button onclick="cancelSpecialCard()">取消</button>`;
  }

  function overloadChoice(canPay, options = {}) {
    return `<h1>${options.archiving ? "锁定过载选项" : "效率优化指令"}</h1>
      <p>选择过载代价。${options.archiving ? "支付选项会使归档等待从5回合增加至8回合，发动时不再扣墨水。" : "额外支付3墨水可避免跳过之后两个己方回合。"}</p>
      <button onclick="confirmOverload(true)" ${canPay?"":"disabled"}>${options.archiving?"锁定：等待增加3回合":"支付3墨水"}</button>
      <button onclick="confirmOverload(false)">${options.archiving?"锁定：发动后跳过2回合":"跳过之后2回合"}</button>
      <button onclick="cancelSpecialCard()">取消</button>`;
  }

  function dock(entries) {
    const rows = entries.map(entry => {
      const source = entry.source === "singularity" ? "奇点" : "技能";
      return `<button type="button" class="archive-dock-entry ${entry.invalid ? "invalid" : ""}" data-archive-order="${entry.order}"
        onmouseenter="previewArchiveTarget(${entry.order},true)" onmouseleave="previewArchiveTarget(${entry.order},false)"
        onclick="showArchiveEntry(${entry.order})">
        <span class="archive-dock-name">${entry.name}</span>
        <span class="archive-dock-meta">${source} · ${entry.remaining} 回合</span>
        <span class="archive-dock-target">${entry.targetLabel}</span>
      </button>`;
    }).join("");
    return `<div class="archive-dock-header"><b>归档区</b><span>${entries.length} 张</span></div>
      <div class="archive-dock-list">${rows||'<span class="archive-dock-empty">暂无归档卡</span>'}</div>`;
  }

  global.GameArchiveView = Object.freeze({discardPicker, overloadChoice, dock});
})(window);
