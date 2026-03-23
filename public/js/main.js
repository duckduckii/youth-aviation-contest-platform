document.addEventListener('DOMContentLoaded', () => {
  const scrollRestoreKey = 'innovation-scroll-position';

  function createDialog(message, options = {}) {
    const { title = '提示', confirmText = '确定', cancelText = '', showCancel = false } = options;
    const overlay = document.createElement('div');
    overlay.className = 'dialog-overlay';
    overlay.innerHTML = `
      <div class="dialog-card" role="dialog" aria-modal="true" aria-label="${title}">
        <div class="dialog-title">${title}</div>
        <div class="dialog-message"></div>
        <div class="dialog-actions"></div>
      </div>
    `;

    overlay.querySelector('.dialog-message').textContent = message;
    const actions = overlay.querySelector('.dialog-actions');

    return new Promise((resolve) => {
      function close(result) {
        overlay.remove();
        document.body.classList.remove('dialog-open');
        resolve(result);
      }

      if (showCancel) {
        const cancelButton = document.createElement('button');
        cancelButton.type = 'button';
        cancelButton.className = 'ghost-btn';
        cancelButton.textContent = cancelText || '取消';
        cancelButton.addEventListener('click', () => close(false));
        actions.appendChild(cancelButton);
      }

      const confirmButton = document.createElement('button');
      confirmButton.type = 'button';
      confirmButton.className = 'primary-btn';
      confirmButton.textContent = confirmText;
      confirmButton.addEventListener('click', () => close(true));
      actions.appendChild(confirmButton);

      overlay.addEventListener('click', (event) => {
        if (event.target === overlay && showCancel) {
          close(false);
        }
      });

      document.body.appendChild(overlay);
      document.body.classList.add('dialog-open');
      confirmButton.focus();
    });
  }

  function showAlert(message, title = '提示') {
    return createDialog(message, { title, confirmText: '我知道了' });
  }

  function showConfirm(message, title = '请确认') {
    return createDialog(message, {
      title,
      confirmText: '确认',
      cancelText: '取消',
      showCancel: true,
    });
  }

  function saveScrollPosition() {
    sessionStorage.setItem(scrollRestoreKey, String(window.scrollY || window.pageYOffset || 0));
  }

  function restoreScrollPosition() {
    const raw = sessionStorage.getItem(scrollRestoreKey);
    if (!raw) {
      return;
    }

    sessionStorage.removeItem(scrollRestoreKey);
    const top = Number(raw);
    if (Number.isNaN(top)) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.scrollTo(0, top);
    });
  }

  restoreScrollPosition();

  const directionForm = document.querySelector('.direction-form');
  if (directionForm) {
    directionForm.addEventListener('submit', async (event) => {
      const checked = directionForm.querySelector('input[name="direction"]:checked');
      if (!checked) {
        event.preventDefault();
        await showAlert('请选择比赛方向');
      }
    });
  }

  const knowledgeConfirmForm = document.querySelector('.knowledge-confirm-form');
  if (knowledgeConfirmForm) {
    knowledgeConfirmForm.addEventListener('submit', async (event) => {
      event.preventDefault();
      const ok = await showConfirm('确认最终提交知识类报名吗？提交后将不可再修改。');
      if (!ok) {
        return;
      }

      knowledgeConfirmForm.submit();
    });
  }

  const formActionInput = document.querySelector('input[name="action"]');
  const innovationForm = document.querySelector('form[action="/innovation"]');
  const saveButton = document.querySelector('[data-action="save"]');
  const submitButton = document.querySelector('[data-action="submit"]');
  const uploadPayloadInput = innovationForm
    ? innovationForm.querySelector('input[name="uploadedFilesPayload"]')
    : null;
  const storageDriver = innovationForm ? innovationForm.dataset.storageDriver || 'local' : 'local';
  const signEndpoint = innovationForm ? innovationForm.dataset.signEndpoint || '/api/uploads/sign' : '';

  function detectContentType(file, expectedExt) {
    if (file && file.type) {
      return file.type;
    }

    const ext = String(expectedExt || '').toLowerCase();
    if (ext === '.pdf') return 'application/pdf';
    if (ext === '.mp4') return 'video/mp4';
    return 'application/octet-stream';
  }

  async function readJsonSafely(response) {
    try {
      return await response.json();
    } catch (error) {
      return null;
    }
  }

  function validateInnovationSubmit() {
    if (!innovationForm) return true;

    const workTitleInput = innovationForm.querySelector('input[name="workTitle"]');
    if (!workTitleInput || !workTitleInput.value.trim()) {
      showAlert('最终提交前请先填写作品题目');
      return false;
    }

    const requiredRows = innovationForm.querySelectorAll('.upload-row[data-required="true"]');
    const missingLabels = [];

    requiredRows.forEach((row) => {
      const hasExistingFile = row.dataset.hasFile === 'true';
      const fileInput = row.querySelector('input[type="file"]');
      const hasSelectedFile = Boolean(fileInput && fileInput.files && fileInput.files.length > 0);

      if (!hasExistingFile && !hasSelectedFile) {
        missingLabels.push(row.dataset.submitLabel || row.dataset.label || '未命名提交项');
      }
    });

    if (missingLabels.length > 0) {
      showAlert(`请先完成必填材料上传：${missingLabels.join('、')}`);
      return false;
    }

    return true;
  }

  async function uploadSelectedFilesToStorage() {
    if (!innovationForm || !uploadPayloadInput) {
      return true;
    }

    uploadPayloadInput.value = '';
    if (storageDriver !== 'oss') {
      return true;
    }

    const payload = {};
    const rows = innovationForm.querySelectorAll('.upload-row[data-field-key]');

    for (const row of rows) {
      const input = row.querySelector('input[type="file"][data-ext]');
      const file = input && input.files ? input.files[0] : null;
      if (!file) {
        continue;
      }

      const contentType = detectContentType(file, input.dataset.ext);
      const signResponse = await fetch(signEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          fieldKey: row.dataset.fieldKey,
          fileName: file.name,
          contentType,
          size: file.size,
        }),
      });

      const signData = await readJsonSafely(signResponse);
      if (!signResponse.ok || !signData) {
        await showAlert((signData && signData.message) || `${row.dataset.label}上传签名失败，请重试`);
        return false;
      }

      const uploadResponse = await fetch(signData.uploadUrl, {
        method: 'PUT',
        headers: signData.headers || {
          'Content-Type': contentType,
        },
        body: file,
      });

      if (!uploadResponse.ok) {
        await showAlert(`${row.dataset.label}上传失败，请重试`);
        return false;
      }

      payload[row.dataset.fieldKey] = {
        objectKey: signData.objectKey,
        originalName: signData.originalName || file.name,
        storedName: signData.storedName,
        size: file.size,
        contentType,
      };

      input.value = '';
      updateSelectedFileState(input, '');
    }

    uploadPayloadInput.value = JSON.stringify(payload);
    return true;
  }

  if (saveButton && formActionInput && innovationForm) {
    saveButton.addEventListener('click', async (event) => {
      event.preventDefault();
      formActionInput.value = 'save';
      const uploaded = await uploadSelectedFilesToStorage();
      if (!uploaded) {
        return;
      }
      saveScrollPosition();
      innovationForm.requestSubmit();
    });
  }

  if (submitButton && formActionInput && innovationForm) {
    submitButton.addEventListener('click', async (event) => {
      event.preventDefault();
      if (!validateInnovationSubmit()) {
        formActionInput.value = 'save';
        return;
      }

      formActionInput.value = 'submit';
      const ok = await showConfirm('确认最终提交吗？提交后将不可再修改。');
      if (!ok) {
        formActionInput.value = 'save';
        return;
      }

      const uploaded = await uploadSelectedFilesToStorage();
      if (!uploaded) {
        formActionInput.value = 'save';
        return;
      }

      innovationForm.requestSubmit();
    });
  }

  const uploadInputs = document.querySelectorAll('input[type="file"][data-max-mb][data-ext]');

  function updateSelectedFileState(input, fileName = '') {
    const targetText = document.querySelector(`[data-file-text="${input.name}"]`);
    const clearButton = document.querySelector(`[data-clear-file-button][data-target-input="${input.name}"]`);

    if (targetText) {
      targetText.textContent = fileName ? `已选择：${fileName}（待保存）` : '';
    }

    if (clearButton) {
      clearButton.classList.toggle('is-hidden', !fileName);
    }
  }

  uploadInputs.forEach((input) => {
    input.addEventListener('change', async () => {
      const file = input.files && input.files[0];
      if (!file) {
        updateSelectedFileState(input, '');
        return;
      }

      const ext = `.${file.name.split('.').pop().toLowerCase()}`;
      const expected = input.dataset.ext.toLowerCase();
      const maxMb = Number(input.dataset.maxMb);

      if (ext !== expected) {
        await showAlert(`文件格式不正确：仅支持 ${expected.toUpperCase()}`);
        input.value = '';
        updateSelectedFileState(input, '');
        return;
      }

      if (file.size > maxMb * 1024 * 1024) {
        await showAlert(`文件过大：不能超过 ${maxMb}MB`);
        input.value = '';
        updateSelectedFileState(input, '');
        return;
      }

      updateSelectedFileState(input, file.name);
    });
  });

  document.addEventListener('click', async (event) => {
    const clearButton = event.target.closest('[data-clear-file-button]');
    if (clearButton) {
      const input = document.querySelector(`input[type="file"][name="${clearButton.dataset.targetInput}"]`);
      if (!input) {
        return;
      }

      input.value = '';
      updateSelectedFileState(input, '');
      return;
    }

    const confirmButton = event.target.closest('[data-confirm-form-button]');
    if (!confirmButton) {
      return;
    }

    event.preventDefault();

    let form = confirmButton.closest('form[data-confirm-message]');
    if (!form && confirmButton.dataset.confirmFormId) {
      form = document.getElementById(confirmButton.dataset.confirmFormId);
    }

    if (!form) {
      return;
    }

    const ok = await showConfirm(
      form.dataset.confirmMessage || '确认继续此操作吗？',
      form.dataset.confirmTitle || '请确认'
    );

    if (!ok) {
      return;
    }

    saveScrollPosition();
    if (typeof form.requestSubmit === 'function') {
      form.requestSubmit();
      return;
    }

    form.submit();
  });
});
