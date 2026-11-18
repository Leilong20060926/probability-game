export function nicknameError(value) {
  if(typeof value!=='string' || !value.trim())return '請輸入暱稱再開始。';
  if([...value.trim()].length>20)return '暱稱最多 20 字。';
  if(/[\u0000-\u001f\u007f-\u009f]/u.test(value.trim()))return '暱稱不能含控制字元。';
  return '';
}
