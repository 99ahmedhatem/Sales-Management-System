-- 2) لوحده: وقف الجدولة بدل unschedule (أسرع ومفيهوش قفل طويل)
update cron.job set active = false where jobname in ('discovery-send','discovery-collect');
