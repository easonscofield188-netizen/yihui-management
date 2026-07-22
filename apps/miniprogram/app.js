const CLOUD_ENV = {
  development: "cloud1-4g5lro06c0b7f4de",
  production: "welfare-management-8dbfp80560715",
};

function getRuntimeEnvironment() {
  try {
    const accountInfo = wx.getAccountInfoSync();
    const envVersion = accountInfo.miniProgram.envVersion;
    return {
      envVersion,
      cloudEnv: ["trial", "release"].includes(envVersion)
        ? CLOUD_ENV.production
        : CLOUD_ENV.development,
    };
  } catch (error) {
    console.warn("读取小程序运行版本失败，默认使用测试云环境", error);
    return {
      envVersion: "develop",
      cloudEnv: CLOUD_ENV.development,
    };
  }
}

App({
  globalData: {
    env: CLOUD_ENV.development,
    envVersion: "develop",
    userInfo: null,
  },

  onLaunch() {
    const runtimeEnvironment = getRuntimeEnvironment();
    this.globalData.env = runtimeEnvironment.cloudEnv;
    this.globalData.envVersion = runtimeEnvironment.envVersion;
    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
      console.info(
        `小程序运行版本：${this.globalData.envVersion}，云环境：${this.globalData.env}`
      );
    }

    this.globalData.userInfo = wx.getStorageSync("userInfo") || null;
  },
}); 
