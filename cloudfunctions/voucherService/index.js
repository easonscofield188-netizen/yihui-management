/**
 * 腾讯云函数: voucherService
 * 功能：整合单据凭证的管理（上传记录、查询、删除等）
 * 运行环境: Node.js 16+
 */
'use strict';

const cloud = require("wx-server-sdk");

// 初始化云开发环境
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();

/**
 * 解析multipart/form-data请求
 * @param {Object} event - 触发事件对象
 * @returns {Promise<Object>} - 解析结果
 */
const parseMultipartForm = (event) => {
  return new Promise((resolve, reject) => {
    try {
      // 检查必要的参数
      if (!event.headers || !event.body) {
        reject(new Error('缺少必要的请求参数'));
        return;
      }
      
      console.log('开始解析multipart/form-data请求');
      
      // 获取content-type头部，提取boundary
      const contentType = event.headers['content-type'] || event.headers['Content-Type'];
      const boundaryMatch = contentType.match(/boundary=(.+)/);
      
      if (!boundaryMatch) {
        reject(new Error('缺少boundary参数'));
        return;
      }
      
      const boundary = boundaryMatch[1];
      console.log('提取到boundary:', boundary);
      
      // 处理body数据
      let bodyData = event.body;
      if (event.isBase64Encoded) {
        console.log('处理Base64编码的body');
        try {
          const buffer = Buffer.from(bodyData, 'base64');
          console.log('Base64解码成功，长度:', buffer.length);
          // 使用binary编码将buffer转换为字符串，以便后续按字符处理二进制数据
          bodyData = buffer.toString('binary');
          console.log('转换为二进制字符串成功');
        } catch (e) {
          console.error('Base64解码失败:', e);
          reject(new Error('Base64解码失败'));
          return;
        }
      }
      
      // 分割parts
      const parts = bodyData.split(`--${boundary}`);
      console.log('分割得到parts数量:', parts.length);
      
      const result = {
        fields: {},
        files: {}
      };
      
      // 处理每个part
      for (let part of parts) {
        // 过滤掉空部分和结束部分
        if (!part || part === '--' || part === '--\r\n' || part === '--\n') continue;
        
        // 移除part开头的换行符
        if (part.startsWith('\r\n')) {
          part = part.slice(2);
        } else if (part.startsWith('\n')) {
          part = part.slice(1);
        }
        
        // 移除part结尾的换行符
        if (part.endsWith('\r\n')) {
          part = part.slice(0, -2);
        } else if (part.endsWith('\n')) {
          part = part.slice(0, -1);
        }
        
        if (!part) continue;
        
        // 分割headers和body
        const separator = '\r\n\r\n';
        const separatorIndex = part.indexOf(separator);
        if (separatorIndex === -1) continue;
        
        const headersStr = part.slice(0, separatorIndex);
        const body = part.slice(separatorIndex + separator.length);
        
        // 解析headers
        const headers = {};
        headersStr.split('\r\n').forEach(line => {
          const [key, ...valueParts] = line.split(': ');
          if (key && valueParts.length > 0) {
            headers[key.toLowerCase()] = valueParts.join(': ');
          }
        });
        
        // 检查是否是内容描述
        if (headers['content-disposition']) {
          const disposition = headers['content-disposition'];
          const nameMatch = disposition.match(/name="([^"]+)"/);
          const filenameMatch = disposition.match(/filename="([^"]+)"/);
          
          if (nameMatch) {
            // 字段名通常是ASCII，但为了保险也进行解码
            const fieldName = Buffer.from(nameMatch[1], 'binary').toString('utf8');
            
            if (filenameMatch) {
              // 是文件
              // 关键修复：对文件名进行UTF-8解码
              const filename = Buffer.from(filenameMatch[1], 'binary').toString('utf8');
              const mimetype = headers['content-type'] || 'application/octet-stream';
              
              console.log('解析到文件:', fieldName, filename, mimetype);
              
              // 转换body为buffer（从binary字符串还原）
              const buffer = Buffer.from(body, 'binary');
              console.log('文件大小:', buffer.length, 'bytes');
              
              result.files[fieldName] = {
                filename,
                mimetype,
                buffer
              };
            } else {
              // 是字段
              // 关键修复：对字段值进行UTF-8解码
              const value = Buffer.from(body, 'binary').toString('utf8');
              console.log('解析到字段:', fieldName, value);
              result.fields[fieldName] = value;
            }
          }
        }
      }
      
      console.log('解析完成:', {
        fields: Object.keys(result.fields),
        files: Object.keys(result.files)
      });
      
      resolve(result);
    } catch (error) {
      console.error('parseMultipartForm函数错误:', error);
      reject(error);
    }
  });
};

/**
 * 云函数入口
 */
exports.main = async (event, context) => {
  // 尝试多种参数获取方式
  let action, data;
  
  // 方式1: 直接从event获取（云函数直接调用）
  if (event.action) {
    action = event.action;
    data = event.data;
    console.log('方式1获取到action:', action);
  }
  // 方式2: 从event.body获取（HTTP访问服务 - JSON格式）
  else if (event.body) {
    try {
      // 检查是否是multipart/form-data格式
      const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'];
      if (contentType && contentType.includes('multipart/form-data')) {
        // 对于multipart/form-data，action应该从event.action或其他方式获取
        console.log('检测到multipart/form-data请求');
        // 对于文件上传，我们可以直接设置action为'upload'
        action = 'upload';
        data = event;
        console.log('方式2.1获取到action: upload');
      } else {
        // 对于JSON格式，尝试解析
        const body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        action = body.action;
        data = body.data;
        console.log('方式2.2获取到action:', action);
      }
    } catch (e) {
      console.error('解析body失败:', e);
      // 即使解析失败，也尝试从event中直接获取action
      if (event.action) {
        action = event.action;
        data = event.data;
        console.log('方式2.3从event直接获取action:', action);
      } else {
        // 对于文件上传，默认设置action为'upload'
        action = 'upload';
        data = event;
        console.log('方式2.4默认设置action: upload');
      }
    }
  }
  // 方式3: 从event.data获取（可能的HTTP访问服务格式）
  else if (event.data) {
    try {
      const eventData = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
      action = eventData.action;
      data = eventData.data;
      console.log('方式3获取到action:', action);
    } catch (e) {
      console.error('解析event.data失败:', e);
    }
  }
  
  try {
    // 根据操作类型执行相应的函数
    switch (action) {
      case 'add':
        return await addVoucher(data);
      case 'list':
        return await getVouchers(data);
      case 'delete':
        return await deleteVoucher(data);
      case 'upload':
        return await uploadImage(event);
      case 'updateBatch':
        return await updateVouchersProject(data);
      default:
        // 处理未知操作
        return {
          code: 400,
          message: '未知操作',
          receivedAction: action,
          eventKeys: Object.keys(event),
          eventType: typeof event,
          eventBodyType: typeof event.body,
          eventBody: event.body
        };
    }
  } catch (error) {
    // 捕获并处理错误
    console.error('凭证管理操作失败', error);
    return {
      code: 500,
      message: '操作失败',
      error: error.message
    };
  }
};

/**
 * 记录凭证信息
 */
async function addVoucher(params) {
  const { 
    projectId = 'DEFAULT_PROJECT', 
    fileName, 
    fileId, 
    fileUrl, 
    uploadTime = Date.now(),
    fileSize,
    mimeType
  } = params;

  if (!fileId || !fileUrl) {
    return { code: 400, message: '缺少文件 ID 或文件 URL' };
  }

  try {
    const res = await db.collection('project_vouchers').add({
      data: {
        projectId,
        fileName,
        fileId,
        fileUrl,
        uploadTime,
        fileSize,
        mimeType,
        createTime: db.serverDate(),
        updateTime: db.serverDate()
      }
    });
    return { code: 0, message: 'success', data: { id: res._id } };
  } catch (err) {
    console.error('添加凭证失败:', err);
    return { code: 500, message: '添加失败', error: err.message };
  }
}

/**
 * 查询凭证列表
 */
async function getVouchers(params) {
  const { projectId = 'DEFAULT_PROJECT' } = params;
  try {
    const res = await db.collection('project_vouchers')
      .where({ projectId })
      .orderBy('createTime', 'desc')
      .get();
    return { code: 0, message: 'success', data: res.data };
  } catch (err) {
    console.error('查询凭证列表失败:', err);
    return { code: 500, message: '查询失败', error: err.message };
  }
}

/**
 * 删除凭证记录
 */
async function deleteVoucher(params) {
  const { id, fileId } = params;
  try {
    // 1. 删除数据库记录
    await db.collection('project_vouchers').doc(id).remove();
    
    // 2. 删除云存储文件
    if (fileId) {
      await cloud.deleteFile({
        fileList: [fileId]
      });
    }

    return { code: 0, message: 'success' };
  } catch (err) {
    console.error('删除凭证失败:', err);
    return { code: 500, message: '删除失败', error: err.message };
  }
}

/**
 * 批量更新凭证所属项目 ID
 */
async function updateVouchersProject(params) {
  const { voucherIds, projectId } = params;
  if (!voucherIds || !Array.isArray(voucherIds) || !projectId) {
    return { code: 400, message: '参数错误' };
  }

  try {
    const _ = db.command;
    await db.collection('project_vouchers')
      .where({
        _id: _.in(voucherIds)
      })
      .update({
        data: {
          projectId,
          updateTime: db.serverDate()
        }
      });
    return { code: 0, message: '更新成功' };
  } catch (err) {
    console.error('批量更新凭证失败:', err);
    return { code: 500, message: '更新失败', error: err.message };
  }
}

// 安全校验：拦截特殊字符
const isSafeInput = (str) => {
  if (!str) return true;
  const unsafePattern = /[<>{}[\]\\^%`|]/;
  return !unsafePattern.test(str);
};

/**
 * 上传图片到云存储
 */
async function uploadImage(event) {
  try {
    console.log('进入uploadImage函数，event:', event);
    
    // 检查是否为multipart/form-data请求
    const contentType = event.headers?.['content-type'] || event.headers?.['Content-Type'];
    let fileContent, fileName, fileType, projectName;
    
    if (contentType && contentType.includes('multipart/form-data')) {
      // 处理multipart/form-data请求
      try {
        console.log('开始解析multipart/form-data请求');
        console.log('Headers:', event.headers);
        console.log('Body长度:', event.body ? event.body.length : 0);
        
        const formData = await parseMultipartForm(event);
        console.log('解析formData成功:', {
          fields: formData.fields,
          files: Object.keys(formData.files),
          fileCount: Object.keys(formData.files).length
        });
        
        if (formData.files.file) {
          console.log('获取到文件数据:', {
            filename: formData.files.file.filename,
            mimetype: formData.files.file.mimetype,
            bufferLength: formData.files.file.buffer.length
          });
          // 确保fileContent是正确的buffer
          if (Buffer.isBuffer(formData.files.file.buffer)) {
            fileContent = formData.files.file.buffer;
            console.log('使用Buffer作为文件内容');
          } else if (typeof formData.files.file.buffer === 'string') {
            fileContent = Buffer.from(formData.files.file.buffer, 'binary');
            console.log('将字符串转换为Buffer作为文件内容');
          } else {
            fileContent = formData.files.file.buffer;
            console.log('直接使用文件内容');
          }
          fileName = formData.files.file.filename;
          fileType = formData.files.file.mimetype;
          projectName = formData.fields.projectName;
        } else {
          // 从fields中获取参数
          console.log('从fields中获取参数:', formData.fields);
          fileName = formData.fields.fileName;
          fileType = formData.fields.fileType;
          projectName = formData.fields.projectName;
        }
      } catch (parseError) {
        console.error('解析formData失败:', parseError);
        return {
          code: 400,
          message: '解析文件数据失败',
          error: parseError.message
        };
      }
    } else {
      // 处理传统的JSON请求
      // 从前端获取Base64编码的图片数据
      // 尝试从 event.body 中获取参数
      if (event.body) {
        if (typeof event.body === 'object') {
          // 直接从对象中获取参数
          fileContent = event.body.data?.file;
          fileName = event.body.data?.fileName;
          fileType = event.body.data?.fileType;
          projectName = event.body.data?.projectName;
        } else if (typeof event.body === 'string') {
          // 尝试解析JSON字符串
          try {
            const bodyObj = JSON.parse(event.body);
            fileContent = bodyObj.data?.file;
            fileName = bodyObj.data?.fileName;
            fileType = bodyObj.data?.fileType;
            projectName = bodyObj.data?.projectName;
          } catch (parseError) {
            console.error('解析body失败:', parseError);
          }
        }
      }
      // 如果上面没有获取到参数，尝试从 event 中直接获取（云函数直接调用）
      if (!fileContent || !fileName || !fileType) {
        fileContent = event.file;
        fileName = event.fileName;
        fileType = event.fileType;
        projectName = event.projectName;
      }
    }

    console.log('获取到的参数:', { 
      fileName, 
      fileType, 
      projectName,
      fileContent: fileContent ? (Buffer.isBuffer(fileContent) ? `[Buffer数据，长度: ${fileContent.length}]` : `[Base64数据，长度: ${fileContent.length}]`) : undefined 
    });

    // 检查必需参数
    if (!fileContent || !fileName) {
      return {
        code: 400,
        message: '缺少必需的参数'
      };
    }

    // 安全校验
    if (!isSafeInput(projectName) || !isSafeInput(fileName)) {
      return {
        code: 400,
        message: '输入包含非法字符'
      };
    }

    // 验证文件类型
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/jpg', 'image/webp'];
    if (fileType && !allowedTypes.includes(fileType)) {
      return {
        code: 400,
        message: '不支持的文件类型，仅支持 JPEG、PNG、GIF、JPG、WEBP'
      };
    }

    try {
      let buffer;
      if (Buffer.isBuffer(fileContent)) {
        // 直接使用Buffer数据
        buffer = fileContent;
      } else {
        // 验证Base64数据格式并解码
        let base64Data = fileContent;
        if (fileContent.startsWith('data:image/')) {
          // 如果包含data URL前缀，则移除
          base64Data = fileContent.split(',')[1];
        }

        // 验证Base64格式
        if (!base64Data || !/^([A-Za-z0-9+/]{4})*([A-Za-z0-9+/]{3}=|[A-Za-z0-9+/]{2}==)?$/.test(base64Data)) {
          return {
            code: 400,
            message: '无效的Base64编码'
          };
        }

        // 解码为二进制数据
        buffer = Buffer.from(base64Data, 'base64');
      }

      // 验证解码后的数据
      if (buffer.length === 0) {
        return {
          code: 400,
          message: '解码后的图片数据为空'
        };
      }

      // 生成唯一的文件名
      const now = new Date();
      const dateStr = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
      const randomNum = Math.floor(Math.random() * 10000);
      const extension = fileName.substring(fileName.lastIndexOf('.')).toLowerCase();
      
      console.log('生成的文件名产品名称:', projectName);
      // 生成存储路径
      const projectFolder = projectName ? `${projectName}/` : '';
      const cloudPath = `bill_voucher/${projectFolder}${dateStr}_${randomNum}${extension}`;

      // 上传文件到云存储
      console.log('准备上传文件到云存储，文件大小:', buffer.length, '文件类型:', fileType, '存储路径:', cloudPath);
      
      const uploadResult = await cloud.uploadFile({
        cloudPath: cloudPath,
        fileContent: buffer
      });

      console.log('文件上传成功，fileID:', uploadResult.fileID);

      // 获取文件的访问链接
      const fileUrl = await cloud.getTempFileURL({
        fileList: [uploadResult.fileID]
      });

      console.log('获取文件访问链接成功:', fileUrl.fileList[0].tempFileURL);

      // 返回成功结果
      return {
        code: 0,
        message: '图片上传成功',
        data: {
          url: fileUrl.fileList[0].tempFileURL,
          fileId: uploadResult.fileID
        }
      };

    } catch (decodeError) {
      console.error('解码Base64数据错误:', decodeError);
      return {
        code: 500,
        message: '图片数据解码失败',
        error: decodeError.message
      };
    }

  } catch (error) {
    console.error('图片上传失败:', error);
    return {
      code: 500,
      message: '图片上传失败',
      error: error.message
    };
  }
}
