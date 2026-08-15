const api = require("../../utils/api");
function nav(){const s=wx.getSystemInfoSync();const b=wx.getMenuButtonBoundingClientRect();const h=s.statusBarHeight||0;return{statusBarHeight:h,navHeight:h+(b?.height?b.height+Math.max(0,b.top-h)*2:44)};}
function timeText(v){const d=new Date(Number(v)||0);if(Number.isNaN(d.getTime()))return"";const p=n=>String(n).padStart(2,"0");return`${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;}
Page({
  data:{...nav(),tabs:[{label:"待审核",value:"PENDING"},{label:"全部",value:"ALL"}],tabIndex:0,list:[],page:1,hasMore:true,loading:false},
  onShow(){const u=api.getCachedUserInfo()||{};if(u.role!=="ADMIN_SUPER")return this.back();this.load(true);},
  onPullDownRefresh(){this.load(true).finally(()=>wx.stopPullDownRefresh());},
  onReachBottom(){if(!this.data.loading&&this.data.hasMore)this.load(false);},
  back(){getCurrentPages().length>1?wx.navigateBack():wx.navigateTo({url:"/pages/admin-center/index"});},
  changeTab(e){const i=Number(e.currentTarget.dataset.index);if(i===this.data.tabIndex)return;this.setData({tabIndex:i},()=>this.load(true));},
  async load(reset=true){if(this.data.loading)return;const page=reset?1:this.data.page;this.setData({loading:true});try{const r=await api.listCategoryReviews({status:this.data.tabs[this.data.tabIndex].value,page,pageSize:20});const incoming=(r.list||[]).map(x=>({...x,timeText:timeText(x.latestTimestamp||x.createdTimestamp)}));this.setData({list:reset?incoming:this.data.list.concat(incoming),page:page+1,hasMore:Boolean(r.hasMore)});}catch(e){wx.showToast({title:e.message||"审核列表加载失败",icon:"none"});}finally{this.setData({loading:false});}},
  open(e){wx.navigateTo({url:`/pages/category-review-detail/index?id=${e.currentTarget.dataset.id}`});}
});
