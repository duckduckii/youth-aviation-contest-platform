document.addEventListener('DOMContentLoaded', () => {
  const directionForm = document.querySelector('.direction-form');
  if (directionForm) {
    directionForm.addEventListener('submit', (event) => {
      const checked = directionForm.querySelector('input[name="direction"]:checked');
      if (!checked) {
        alert('请选择比赛方向');
        event.preventDefault();
        return;
      }

      const label = checked.dataset.label || checked.value;
      const ok = window.confirm(`您确认选择${label}吗？一旦确定则无法更改。`);
      if (!ok) {
        event.preventDefault();
      }
    });
  }

  const formActionInput = document.querySelector('input[name="action"]');
  const saveButton = document.querySelector('[data-action="save"]');
  const submitButton = document.querySelector('[data-action="submit"]');

  if (saveButton && formActionInput) {
    saveButton.addEventListener('click', () => {
      formActionInput.value = 'save';
    });
  }

  if (submitButton && formActionInput) {
    submitButton.addEventListener('click', () => {
      formActionInput.value = 'submit';
      const ok = window.confirm('确认最终提交吗？提交后将不可再修改。');
      if (!ok) {
        formActionInput.value = 'save';
      }
    });
  }

  const uploadInputs = document.querySelectorAll('input[type="file"][data-max-mb][data-ext]');
  uploadInputs.forEach((input) => {
    input.addEventListener('change', () => {
      const file = input.files && input.files[0];
      const targetText = document.querySelector(`[data-file-text="${input.name}"]`);
      if (!file) {
        if (targetText) targetText.textContent = '';
        return;
      }

      const ext = `.${file.name.split('.').pop().toLowerCase()}`;
      const expected = input.dataset.ext.toLowerCase();
      const maxMb = Number(input.dataset.maxMb);

      if (ext !== expected) {
        alert(`文件格式不正确：仅支持 ${expected.toUpperCase()}`);
        input.value = '';
        if (targetText) targetText.textContent = '';
        return;
      }

      if (file.size > maxMb * 1024 * 1024) {
        alert(`文件过大：不能超过 ${maxMb}MB`);
        input.value = '';
        if (targetText) targetText.textContent = '';
        return;
      }

      if (targetText) {
        targetText.textContent = `已选择：${file.name}`;
      }
    });
  });
});
