/**
 * 腾讯云函数: contractPreviewService
 * 功能：项目合同与预览图的管理（上传、查询、删除等）
 */
'use strict';

const cloud = require("wx-server-sdk");

cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 解析multipart/form-data请求
 */
const parseMultipartForm = (event) => {
  return new Promise((resolve, reject) => {
    try {
      if (!event.headers || !event.body) {
        reject(new Error('缺少必要的请求参数'));
        return;
      }
      
      const contentType = event.headers['content-type'] || event.headers['Content-Type'];
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      
      if (!boundaryMatch) {
        reject(new Error('缺少boundary参数'));
        return;
      }
      
      const boundary = boundaryMatch[1];
      let bodyData = event.body;
      if (event.isBase64Encoded) {
        const buffer = Buffer.from(bodyData, 'base64');
        bodyData = buffer.toString('binary');
      }
      
      const parts = bodyData.split(`--${boundary}`);
      const result = { fields: {}, files: {} };
      
      for (let part of parts) {
        if (!part || part === '--' || part === '--\r\n' || part === '--\n') continue;
        
        if (part.startsWith('\r\n')) part = part.slice(2);
        else if (part.startsWith('\n')) part = part.slice(1);
        
        if (part.endsWith('\r\n')) part = part.slice(0, -2);
        else if (part.endsWith('\n')) part = part.slice(0, -1);
        
        if (!part) continue;
        
        const separator = '\r\n\r\n';
        const separatorIndex = part.indexOf(separator);
        if (separatorIndex === -1) continue;
        
        const headersStr = part.slice(0, separatorIndex);
        const body = part.slice(separatorIndex + separator.length);
        
        const headers = {};
        headersStr.split('\r\n').forEach(line => {
          const [key, ...valueParts] = line.split(': ');
          if (key && valueParts.length > 0) {
            headers[key.toLowerCase()] = valueParts.join(': ');
          }
        });
        
        if (headers['content-disposition']) {
          const disposition = headers['content-disposition'];
          const nameMatch = disposition.match(/name="([^"]+)"/);
          const filenameMatch = disposition.match(/filename="([^"]+)"/);
          
          if (nameMatch) {
            const fieldName = Buffer.from(nameMatch[1], 'binary').toString('utf8');
            if (filenameMatch) {
              const filename = Buffer.from(filenameMatch[1], 'binary').toString('utf8');
              const mimetype = headers['content-type'] || 'application/octet-stream';
              const buffer = Buffer.from(body, 'binary');
              result.files[fieldName] = { filename, mimetype, buffer };
            } else {
              const value = Buffer.from(body, 'binary').toString('utf8');
              result.fields[fieldName] = value;
            }
          }
        }
      }
      resolve(result);
    } catch (error) {
      reject(error);
    }
  });
};

exports.main = async (event, context) => {
  let action, data;
  
  if (event.action) {
    action = event.action;
    data = event.data;
  } else if (event.body) {
    try {
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'];
      if (contentType && contentType.includes('multipart/form-data')) {
        action = 'upload';
        data = event;
      } else {
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        action = body.action;
        data = body.data;
      }
    } catch (e) {
      action = 'upload';
      data = event;
    }
  }

  try {
    switch (action) {
      case 'upload':
        return await handleUpload(event);
      case 'delete':
        return await handleDelete(data);
      case 'list':
        return await handleList(data);
      case 'deleteAllByProject':
        return await handleDeleteAllByProject(data);
      case 'updateBatch':
        return await handleUpdateBatch(data);
      case 'renameProjectFiles':
        return await handleRenameProjectFiles(data);
      default:
        return { code: 400, message: '未知操作' };
    }
  } catch (error) {
    console.error('操作失败', error);
    return { code: 500, message: '操作失败', error: error.message };
  }
};

/**
 * 批量更新项目 ID
 */
async function handleUpdateBatch(params) {
  const { fileIds, projectId, type } = params;
  if (!fileIds || !Array.isArray(fileIds) || !projectId || !type) {
    return { code: 400, message: '缺少参数' };
  }

  const collectionName = type === 'contract' ? 'project_contracts' : 'project_previews';

  try {
    const _ = db.command;
    await db.collection(collectionName).where({
      _id: _.in(fileIds)
    }).update({
      data: {
        projectId,
        updateTime: db.serverDate()
      }
    });
    return { code: 0, message: '更新成功' };
  } catch (err) {
    console.error('批量更新失败:', err);
    return { code: 500, message: '更新失败', error: err.message };
  }
}

/**
 * 处理上传
 */
async function handleUpload(event) {
  try {
    const formData = await parseMultipartForm(event);
    const { type, projectId, projectName } = formData.fields;
    const file = formData.files.file;

    if (!file || !type || !projectId || !projectName) {
      return { code: 400, message: '缺少必要参数' };
    }

    // 校验
    if (type === 'contract') {
      if (file.mimetype === 'application/pdf' && file.buffer.length > 10 * 1024 * 1024) {
        return { code: 400, message: 'PDF文件最大支持10M，请压缩后重新上传' };
      }
    } else if (type === 'preview') {
      const allowedImageTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/jpg', 'image/webp'];
      if (!allowedImageTypes.includes(file.mimetype)) {
        return { code: 400, message: '预览图仅支持图片格式' };
      }
      // 检查数量限制 (前端也会校验，后端双重保险)
      const countRes = await db.collection('project_previews').where({ projectId }).count();
      if (countRes.total >= 4) {
        return { code: 400, message: '最多可上传4张预览图' };
      }
    }

    // 生成路径
    const now = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const randomNum = Math.floor(Math.random() * 900000) + 100000; // 6位随机数
    const extension = file.filename.substring(file.filename.lastIndexOf('.')).toLowerCase();
    
    // 转义项目名称
    const escapedProjectName = projectName.replace(/[\\/:*?"<>|]/g, '_');
    
    let cloudPath = '';
    let collectionName = '';
    if (type === 'contract') {
      cloudPath = `project-contract/${dateStr}/${escapedProjectName}/contract_${randomNum}${extension}`;
      collectionName = 'project_contracts';
    } else {
      cloudPath = `project-previw-images/${dateStr}/${escapedProjectName}/previw_${randomNum}${extension}`;
      collectionName = 'project_previews';
    }

    // 上传
    const uploadRes = await cloud.uploadFile({
      cloudPath,
      fileContent: file.buffer
    });

    // 获取链接
    const urlRes = await cloud.getTempFileURL({
      fileList: [uploadRes.fileID]
    });
    const fileUrl = urlRes.fileList[0].tempFileURL;

    // 记录数据库
    const dbData = {
      projectId,
      url: fileUrl,
      fileId: uploadRes.fileID,
      createdAt: db.serverDate()
    };
    if (type === 'contract') {
      dbData.name = file.filename;
      dbData.type = file.mimetype;
    }

    const addRes = await db.collection(collectionName).add({ data: dbData });

    return {
      code: 0,
      message: '上传成功',
      data: {
        id: addRes._id,
        url: fileUrl,
        fileId: uploadRes.fileID,
        name: file.filename,
        type: file.mimetype
      }
    };
  } catch (err) {
    console.error('上传失败:', err);
    return { code: 500, message: '上传失败', error: err.message };
  }
}

/**
 * 当项目名称修改时，同步修改云存储中的路径
 */
async function handleRenameProjectFiles(params) {
  const { projectId, oldName, newName } = params;
  
  if (!projectId || !oldName || !newName || oldName === newName) {
    return { code: 0, message: '无需重命名' };
  }

  const escapedOldName = oldName.replace(/[\\/:*?"<>|]/g, '_');
  const escapedNewName = newName.replace(/[\\/:*?"<>|]/g, '_');

  console.log(`开始重命名项目合同与预览图路径: ${escapedOldName} -> ${escapedNewName}`);

  try {
    const results = {
      contracts: { total: 0, success: 0 },
      previews: { total: 0, success: 0 }
    };

    // 处理函数
    const processFiles = async (collectionName, typeLabel) => {
      const res = await db.collection(collectionName).where({ projectId }).get();
      const files = res.data;
      if (!files || files.length === 0) return;

      results[typeLabel].total = files.length;
      
      for (const file of files) {
        const oldFileId = file.fileId;
        const oldPathPart = `/${escapedOldName}/`;
        
        if (!oldFileId.includes(oldPathPart)) {
          console.log(`文件 ${file._id} 路径不匹配，跳过`);
          results[typeLabel].success++; // 视为成功，因为不需要处理
          continue;
        }

        try {
          const newPathPart = `/${escapedNewName}/`;
          const newFileId = oldFileId.replace(oldPathPart, newPathPart);
          
          // 提取 cloudPath (去掉 cloud://env-id.env-id-xxx/ 部分)
          const pathStartIndex = newFileId.indexOf('/', 9);
          const cloudPath = newFileId.substring(pathStartIndex + 1);
          
          console.log(`处理文件 ${file._id}: ${oldFileId} -> ${cloudPath}`);

          // 1. 下载
          const downloadRes = await cloud.downloadFile({ fileID: oldFileId });
          // 2. 上传
          const uploadRes = await cloud.uploadFile({
            cloudPath: cloudPath,
            fileContent: downloadRes.fileContent
          });
          // 3. 获取新链接
          const getUrlRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] });
          const newUrl = getUrlRes.fileList[0].tempFileURL;

          // 4. 更新数据库
          await db.collection(collectionName).doc(file._id).update({
            data: {
              fileId: uploadRes.fileID,
              url: newUrl
            }
          });

          // 5. 删除旧文件
          await cloud.deleteFile({ fileList: [oldFileId] });
          
          results[typeLabel].success++;
        } catch (err) {
          console.error(`处理文件 ${file._id} 失败:`, err);
        }
      }
    };

    await processFiles('project_contracts', 'contracts');
    await processFiles('project_previews', 'previews');

    return { code: 0, message: '处理完成', data: results };
  } catch (err) {
    console.error('重命名项目文件失败:', err);
    return { code: 500, message: '处理失败', error: err.message };
  }
}

/**
 * 处理删除
 */
async function handleDelete(params) {
  const { id, fileId, type } = params;
  if (!id || !fileId || !type) {
    return { code: 400, message: '缺少参数' };
  }

  const collectionName = type === 'contract' ? 'project_contracts' : 'project_previews';

  try {
    // 1. 删除数据库记录
    await db.collection(collectionName).doc(id).remove();
    
    // 2. 删除云文件
    await cloud.deleteFile({
      fileList: [fileId]
    });

    // 日志记录 (简单模拟)
    console.log(`[LOG] 删除文件: path=${fileId}, time=${new Date().toISOString()}, type=${type}`);

    return { code: 0, message: '删除成功' };
  } catch (err) {
    console.error('删除失败:', err);
    return { code: 500, message: '删除失败', error: err.message };
  }
}

/**
 * 查询列表
 */
async function handleList(params) {
  const { projectId, type } = params;
  if (!projectId || !type) {
    return { code: 400, message: '缺少参数' };
  }

  const collectionName = type === 'contract' ? 'project_contracts' : 'project_previews';

  try {
    const res = await db.collection(collectionName)
      .where({ projectId })
      .orderBy('createdAt', 'desc')
      .get();
    return { code: 0, message: '查询成功', data: res.data };
  } catch (err) {
    console.error('查询失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}

/**
 * 删除项目下所有文件 (联动切换)
 */
async function handleDeleteAllByProject(params) {
  const { projectId, type } = params;
  if (!projectId || !type) {
    return { code: 400, message: '缺少参数' };
  }

  const collectionName = type === 'contract' ? 'project_contracts' : 'project_previews';

  try {
    const res = await db.collection(collectionName).where({ projectId }).get();
    const files = res.data;
    
    if (files.length > 0) {
      const fileIds = files.map(f => f.fileId);
      
      // 删除云文件
      await cloud.deleteFile({
        fileList: fileIds
      });
      
      // 删除数据库记录
      const _ = db.command;
      await db.collection(collectionName).where({ projectId }).remove();
      
      // 日志记录
      console.log(`[LOG] 批量删除项目文件: projectId=${projectId}, count=${files.length}, type=${type}, time=${new Date().toISOString()}`);
    }

    return { code: 0, message: '清理成功' };
  } catch (err) {
    console.error('清理失败:', err);
    return { code: 500, message: '清理失败', error: err.message };
  }
}
