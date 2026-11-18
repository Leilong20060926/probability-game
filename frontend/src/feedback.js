import { api, escapeHtml as e } from './storage.js';

const difficulties = { easy: '太易', medium: '適中', hard: '太難' };

export function createFeedbackPrompt({ request = api } = {}) {
    const dialog = document.createElement('dialog');
    dialog.className = 'feedback-dialog';
    dialog.setAttribute('aria-labelledby', 'feedback-title');
    document.body.append(dialog);

    dialog.addEventListener('cancel', event => event.preventDefault());
    dialog.addEventListener('keydown', event => event.stopPropagation());

    let playerId = null, done = false, generation = 0;

    function setPlayer(id) {
        generation++;
        playerId = id;
        done = false;
        if (dialog.open) dialog.close();
    }

    function valid(id, version) {
        return playerId === id && generation === version;
    }

    function complete() {
        done = true;
        dialog.close();
    }

    function form(id, version, nickname) {
        dialog.innerHTML = `<h2 id="feedback-title">首次遊玩回饋</h2>
      <p>每位玩家只需填寫一次，三題皆為必填。</p>
      <p>玩家 ID：<code>${e(nickname || '未設定暱稱')}</code></p>
      <form>
        <label>難度<select name="difficulty" required>
          <option value="">請選擇</option>
          <option value="easy">太易</option>
          <option value="medium">適中</option>
          <option value="hard">太難</option>
        </select></label>
        <label>願不願意再玩<select name="replay" required>
          <option value="">請選擇</option>
          <option value="yes">是</option>
          <option value="no">否</option>
        </select></label>
        <label>好玩程度（1–5 分）<select name="enjoyment" required>
          <option value="">請選擇</option>
          ${[1, 2, 3, 4, 5].map(n =>
            `<option value="${n}">${n} 分</option>`
        ).join('')}
        </select></label>
        <p role="status"></p>
        <button type="submit">送出回饋</button>
      </form>`;

        const element = dialog.querySelector('form');
        element.querySelector('select').focus();

        element.onsubmit = async event => {
            event.preventDefault();
            if (!element.reportValidity() || !valid(id, version)) return;

            const fields = element.elements;
            const body = {
                playerId: id,
                difficulty: fields.difficulty.value,
                replay: fields.replay.value === 'yes',
                enjoyment: Number(fields.enjoyment.value),
            };

            const status = element.querySelector('[role="status"]');
            const controls = [...element.querySelectorAll('select, button')];
            controls.forEach(control => control.disabled = true);
            status.textContent = '正在儲存…';

            try {
                const result = await request('/api/feedback', { body });
                if (!valid(id, version)) return;

                if (result.playerId !== id || !result.submitted) {
                    throw new Error('玩家身分已改變，請重新整理頁面。');
                }
                complete();
            } catch (error) {
                if (!valid(id, version)) return;

                if (error.code === 'FEEDBACK_ALREADY_SUBMITTED') {
                    await load(id, version);
                    return;
                }

                status.textContent =
                    `${error.message}。尚未確認儲存成功，請重試。`;
                controls.forEach(control => control.disabled = false);
            }
        };
    }

    async function load(id, version) {
        dialog.innerHTML = `<h2 id="feedback-title">首次遊玩回饋</h2>
      <p role="status">正在確認填寫狀態…</p>`;

        try {
            const result = await request('/api/feedback');
            if (!valid(id, version)) return;

            if (result.playerId !== id) {
                throw new Error('玩家身分已改變，請重新整理頁面。');
            }

            if (result.submitted) complete();
            else if (result.required) form(id, version, result.playerNickname);
            else dialog.close();
        } catch (error) {
            if (!valid(id, version)) return;

            dialog.innerHTML = `<h2 id="feedback-title">首次遊玩回饋</h2>
        <p role="status">${e(error.message)}</p>
        <button type="button">重新連線</button>`;

            dialog.querySelector('button').onclick = () => load(id, version);
        }
    }

    function check() {
        if (!playerId || done || dialog.open) return;

        dialog.innerHTML = `<h2 id="feedback-title">首次遊玩回饋</h2>
      <p>正在確認填寫狀態…</p>`;
        dialog.showModal();
        void load(playerId, generation);
    }

    return { setPlayer, check };
}

export function mountFeedbackList(
    root,
    { request = api, confirm = message => globalThis.confirm(message) } = {}
) {
    let page = 1, pages = 1, busy = false, retry = null;

    const date = value => new Date(value).toLocaleString('zh-TW', {
        timeZone: 'Asia/Taipei',
        hour12: false,
    });

    const status = message => {
        root.querySelector('[role="status"]').textContent = message;
    };

    function buttons() {
        root.querySelectorAll('button').forEach(button => {
            button.disabled = busy;
        });
        root.querySelector('[data-prev]').disabled = busy || page <= 1;
        root.querySelector('[data-next]').disabled = busy || page >= pages;
        root.querySelector('[data-retry]').hidden = !retry;
    }

    function paint(result) {
        page = result.page;
        pages = Math.max(1, Math.ceil(result.total / result.pageSize));

        root.innerHTML = `<h1>用戶回饋</h1>
      <p>共 ${e(result.total)} 份回饋，每位玩家一份；時間為台灣時間。</p>
      <p role="status" aria-live="polite"></p>
      <button data-refresh>重新整理</button>
      <button data-retry hidden>重試</button>

      <div class="table-scroll">
        <table class="analysis-table">
          <thead><tr>
            <th>玩家 ID</th><th>難度</th><th>願不願意再玩</th>
            <th>好玩程度</th><th>填寫時間</th><th>操作</th>
          </tr></thead>
          <tbody>${result.items.length ? result.items.map(row => `<tr>
            <td><code>${e(row.playerNickname || '未設定暱稱')}</code></td>
            <td>${e(difficulties[row.difficulty])}</td>
            <td>${row.replay ? '是' : '否'}</td>
            <td>${e(row.enjoyment)} / 5</td>
            <td>${e(date(row.submittedAt))}</td>
            <td>
              <button class="feedback-delete"
                data-delete-feedback="${e(row.playerId)}">刪除</button>
            </td>
          </tr>`).join('') :
                '<tr><td colspan="6">目前還沒有回饋。</td></tr>'
            }</tbody>
        </table>
      </div>

      <div class="feedback-pages">
        <button data-prev>上一頁</button>
        <span>第 ${page} / ${pages} 頁</span>
        <button data-next>下一頁</button>
      </div>`;

        root.querySelector('[data-refresh]').onclick =
            () => task(() => load(1));

        root.querySelector('[data-prev]').onclick =
            () => task(() => load(page - 1));

        root.querySelector('[data-next]').onclick =
            () => task(() => load(page + 1));

        root.querySelector('[data-retry]').onclick = () => {
            if (retry) task(retry);
        };

        root.querySelectorAll('[data-delete-feedback]').forEach(button => {
            button.onclick = () => remove(
                result.items.find(
                    row => row.playerId === button.dataset.deleteFeedback
                )
            );
        });

        buttons();
    }

    async function load(next = page) {
        const result = await request(
            `/api/feedback/responses?page=${next}&pageSize=50`
        );

        const last = Math.max(1, Math.ceil(result.total / result.pageSize));
        if (result.page > last) return load(last);

        paint(result);
    }

    async function task(operation, success = '已取得最新回饋。') {
        if (busy) return;

        busy = true;
        retry = null;
        buttons();
        status('正在等待伺服器…');

        try {
            await operation();
            status(success);
        } catch (error) {
            retry = error.feedbackRetry || operation;
            status(
                error.feedbackMessage ||
                `${error.message || '連線失敗'}。請重試。`
            );
        } finally {
            busy = false;
            buttons();
        }
    }

    function remove(row) {
        if (busy || !row) return;

        const message =
            `確定刪除玩家「${row.playerNickname || '未設定暱稱'}」的回饋？\n` +
            '這會移除這份回答，無法復原；這位玩家不會因此再次收到問卷。';

        if (!confirm(message)) return;

        return task(async () => {
            let deleted = false;

            try {
                await request(
                    '/api/feedback/responses/' + encodeURIComponent(row.playerId),
                    { method: 'DELETE' }
                );
                deleted = true;
                await load(page);
            } catch (error) {
                if (deleted) {
                    error.feedbackMessage =
                        '回饋已刪除，但列表更新失敗；請按「重試」重新載入列表。';
                    error.feedbackRetry = () => load(page);
                } else {
                    error.feedbackMessage =
                        `${error.message || '刪除結果尚未確認'}。請重試，或重新整理確認列表。`;
                }
                throw error;
            }
        }, '此筆回饋已移除，列表已更新。');
    }

    paint({ items: [], total: 0, page: 1, pageSize: 50 });
    void task(() => load());

    return { refresh: () => task(() => load()) };
}