/**
 * 腾讯云函数: cronService
 * 功能：每日定时更新项目周期
 */
'use strict';

const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
const _ = db.command;

exports.main = async (event, context) => {
  const now = new Date();
  // 考虑到时区问题，使用北京时间 (UTC+8)
  const beijingTime = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const today = beijingTime.toISOString().split('T')[0];
  
  console.log(`开始执行每日更新任务，日期: ${today}`);

  try {
    // 1. 获取所有未结清的常规项目（处理分页，TCB 默认限制 20 条，最大 100 条）
    const MAX_LIMIT = 100;
    const countResult = await db.collection('projects').where({
      type: _.neq('historical'),
      status: _.neq('closed')
    }).count();
    
    const total = countResult.total;
    console.log(`总共有 ${total} 个活跃项目待检查`);
    
    let updateCount = 0;
    const batchCount = Math.ceil(total / MAX_LIMIT);
    
    for (let i = 0; i < batchCount; i++) {
      const res = await db.collection('projects').where({
        type: _.neq('historical'),
        status: _.neq('closed')
      })
      .skip(i * MAX_LIMIT)
      .limit(MAX_LIMIT)
      .get();

      const projects = res.data;
      console.log(`正在处理第 ${i + 1} 批次，共 ${projects.length} 个项目`);

      for (const project of projects) {
        const updateData = {
          updateTime: db.serverDate()
        };

        // 更新项目周期结束日期
        if (project.period && project.period[0]) {
          updateData.period = [project.period[0], today];
        }

        // 如果在交付中，更新施工周期结束日期
        if (project.status === 'constructing' && project.constructionPeriod && project.constructionPeriod[0]) {
          updateData.constructionPeriod = [project.constructionPeriod[0], today];
        }

        // 如果在结账中，更新回款周期结束日期
        if (project.status === 'settling' && project.collectionPeriod && project.collectionPeriod[0]) {
          updateData.collectionPeriod = [project.collectionPeriod[0], today];
        }

        await db.collection('projects').doc(project._id).update({
          data: updateData
        });
        updateCount++;
      }
    }

    return { code: 0, message: `成功更新 ${updateCount} 个项目`, date: today };
  } catch (err) {
    console.error('每日更新任务失败:', err);
    return { code: 500, message: '任务失败', error: err.message };
  }
};
