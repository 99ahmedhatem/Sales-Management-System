# نشر دوال Supabase (admin-create-user و review-contract) بأمر واحد.
# التشغيل من فولدر المشروع الرئيسي في PowerShell:
#     powershell -ExecutionPolicy Bypass -File .\scripts\deploy-functions.ps1
# الاتنين هيطلبوا منك توكن Supabase (بيتكتب مخفي، ومش بيتخزن في أي ملف).

$ErrorActionPreference = 'Stop'
$ProjectRef = 'zchhqqsagrqyexzpfrms'
$Functions  = @('admin-create-user', 'review-contract')

function Run($cmd) {
    Write-Host "`n> $cmd" -ForegroundColor Cyan
    Invoke-Expression $cmd
    if ($LASTEXITCODE -ne 0) { throw "فشل الأمر: $cmd (exit $LASTEXITCODE)" }
}

# 1) التوكن
$secure = Read-Host "الصق توكن Supabase (يبدأ بـ sbp_) ثم Enter" -AsSecureString
$ptr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
$token = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($ptr)
[Runtime.InteropServices.Marshal]::ZeroFreeBSTR($ptr)
if (-not $token -or -not $token.StartsWith('sbp_')) { throw "التوكن غلط: لازم يبدأ بـ sbp_" }
$env:SUPABASE_ACCESS_TOKEN = $token

# 2) الدوال موجودة في الريبو؟
foreach ($f in $Functions) {
    if (-not (Test-Path "supabase\functions\$f")) { throw "مفيش فولدر supabase\functions\$f. قول للـ AI يعمله الأول." }
}

# 3) ربط المشروع ثم نشر الدوال
Run "npx --yes supabase link --project-ref $ProjectRef"
foreach ($f in $Functions) { Run "npx --yes supabase functions deploy $f" }

Write-Host "`nتم. الدوال المنشورة:" -ForegroundColor Green
Run "npx --yes supabase functions list --project-ref $ProjectRef"

# 4) تنظيف: التوكن ما يفضلش في الجلسة
Remove-Item Env:SUPABASE_ACCESS_TOKEN
Write-Host "`nاحذف التوكن من صفحة Access tokens في Supabase بعد ما تخلص." -ForegroundColor Yellow
