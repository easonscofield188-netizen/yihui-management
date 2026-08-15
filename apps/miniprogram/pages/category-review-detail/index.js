const api=require("../../utils/api");
const {CATEGORY_REVIEW_TEMPLATE_ID}=require("../../utils/wechat-subscription");
const {requestLowCountSubscriptions}=require("../../utils/subscription-auto-prompt");
const SERVICE_SCENES=new Set([1014]);
function nav(){const s=wx.getSystemInfoSync(),b=wx.getMenuButtonBoundingClientRect(),h=s.statusBarHeight||0;return{statusBarHeight:h,navHeight:h+(b?.height?b.height+Math.max(0,b.top-h)*2:44)};}
function serviceEntry(o){if(o.source==="wechat_subscribe")return true;if(getCurrentPages().length!==1)return false;try{return SERVICE_SCENES.has(Number(wx.getEnterOptionsSync?.().scene));}catch(e){return false;}}
function normalizedName(value){return String(value||"").normalize("NFKC").toLowerCase().replace(/[\s\-_/\\·,，.。()（）【】\[\]{}]/g,"");}
function canonicalUnit(value){
 const unit=normalizedName(value).replace(/²/g,"2").replace(/³/g,"3");
 const aliases={米:"m",公尺:"m",平方米:"m2","㎡":"m2","m²":"m2",立方米:"m3","m³":"m3",公斤:"kg",千克:"kg",克:"g",吨:"t",升:"l",毫升:"ml"};
 return aliases[unit]||unit;
}
function nameIsRelated(left,right){
 const a=normalizedName(left),b=normalizedName(right);
 if(!a||!b)return false;
 if(a===b)return true;
 const shorter=a.length<=b.length?a:b,longer=a.length>b.length?a:b;
 if(shorter.length>=2&&longer.includes(shorter))return true;
 let longest=0;
 for(let i=0;i<a.length;i+=1)for(let j=0;j<b.length;j+=1){let size=0;while(a[i+size]&&a[i+size]===b[j+size])size+=1;if(size>longest)longest=size;}
 if(longest>=2&&longest/shorter.length>=0.6)return true;
 const grams=value=>{const result=[];for(let i=0;i<value.length-1;i+=1)result.push(value.slice(i,i+2));return result;};
 const first=grams(a),second=grams(b),remaining=[...second];let matches=0;
 first.forEach(item=>{const index=remaining.indexOf(item);if(index>=0){matches+=1;remaining.splice(index,1);}});
 return first.length>0&&second.length>0&&(2*matches)/(first.length+second.length)>=0.4;
}
function mergeValidation(review,config){
 const reasons=[];
 if(!nameIsRelated(review.proposedLabel,config.label))reasons.push(`名称差异过大：“${review.proposedLabel}”与“${config.label}”不属于明显近似类目`);
 const targetUnit=canonicalUnit(config.commonUnit);
 const sourceUnits=Array.from(new Set([review.proposedUnit,...(review.unitCandidates||[]),...(review.sources||[]).map(item=>item.originalUnit)].map(canonicalUnit).filter(Boolean)));
 if(!targetUnit||!sourceUnits.length)reasons.push("申请或已有配置缺少单位");
 else if(sourceUnits.some(unit=>unit!==targetUnit))reasons.push(`单位不一致：申请为“${sourceUnits.join("、")}”，配置为“${config.commonUnit}”`);
 return{mergeAllowed:reasons.length===0,mergeHint:reasons.join("；")};
}
function configFieldsChanged(review,form){
 const clean=value=>String(value||"").normalize("NFKC").trim();
 return clean(form.label)!==clean(review?.proposedLabel)||clean(form.commonUnit)!==clean(review?.proposedUnit);
}
Page({
 data:{...nav(),id:"",notificationId:"",review:null,form:{label:"",commonUnit:"",description:"",reason:""},hasConfigChanges:false,configs:[],categoryReviewSubscription:null,mergeVisible:false,loading:true,operating:false,isServiceEntry:false},
 onLoad(o={}){this.setData({id:String(o.id||""),notificationId:String(o.notificationId||""),isServiceEntry:serviceEntry(o)});this.load();},
 back(){if(this.data.isServiceEntry)return wx.exitMiniProgram({fail:()=>wx.switchTab({url:"/pages/profile/index"})});getCurrentPages().length>1?wx.navigateBack():wx.redirectTo({url:"/pages/category-review-list/index"});},
 async load(){this.setData({loading:true});try{const [r,c,s]=await Promise.all([api.getCategoryReviewDetail(this.data.id),api.queryConfigs("COST_CATEGORY","all"),api.getCategoryReviewSubscriptionStatus(),this.data.notificationId?api.getNotificationDetail(this.data.notificationId).catch(()=>null):Promise.resolve(null)]);wx.removeStorageSync("notificationUnreadCountCachedAt");const form={label:r.approvedLabel||r.proposedLabel||"",commonUnit:r.approvedUnit||r.proposedUnit||"",description:"报价单使用的新类目，经审核新增",reason:r.reviewRemark||""};this.setData({review:r,configs:(c||[]).map(item=>({...item,...mergeValidation(r,item)})),categoryReviewSubscription:s,form,hasConfigChanges:r.status==="PENDING"&&configFieldsChanged(r,form)});}catch(e){wx.showToast({title:e.message||"审核详情加载失败",icon:"none"});}finally{this.setData({loading:false});}},
 input(e){const field=e.currentTarget.dataset.field,value=e.detail.value,form={...this.data.form,[field]:value};this.setData({form,hasConfigChanges:configFieldsChanged(this.data.review,form)});},
 approve(){if(this.data.review.status!=="PENDING"||this.data.operating)return;const f=this.data.form;if(!f.label.trim()||!f.commonUnit.trim())return wx.showToast({title:"请填写名称和常用单位",icon:"none"});const changed=configFieldsChanged(this.data.review,f),changeTip=changed?"你修改了原申请的名称或单位，本次修改只用于新增配置，原报价单内容不会改变。":"";this.withSubscription(()=>wx.showModal({title:"通过并新增配置",content:`将新增“${f.label.trim()}”，常用单位为“${f.commonUnit.trim()}”。${changeTip}`,confirmText:"确认通过",success:r=>r.confirm&&this.submit({reviewAction:"APPROVE",label:f.label.trim(),commonUnit:f.commonUnit.trim(),description:f.description.trim(),reason:f.reason.trim()})}));},
 reject(){if(this.data.review.status!=="PENDING"||this.data.operating)return;this.withSubscription(()=>wx.showModal({title:"驳回类目申请",content:"驳回不会影响原报价单，确定继续吗？",confirmText:"确认驳回",confirmColor:"#b3261e",success:r=>r.confirm&&this.submit({reviewAction:"REJECT",reason:this.data.form.reason.trim()})}));},
 openMerge(){if(this.data.review.status==="PENDING")this.withSubscription(()=>this.setData({mergeVisible:true}));},
 closeMerge(e){if(e?.detail?.visible===true)return;this.setData({mergeVisible:false});},
 merge(e){const c=this.data.configs.find(x=>(x._id||x.id)===e.currentTarget.dataset.id);if(!c)return;if(!c.mergeAllowed)return wx.showModal({title:"不允许合并",content:`${c.mergeHint}。请改选更接近的已有类目，或使用“通过新增”。`,showCancel:false,confirmText:"我知道了"});wx.showModal({title:"合并到已有配置",content:`名称近似且单位一致，确认合并到“${c.label}”吗？原报价单不会改变。`,confirmText:"确认合并",success:r=>{if(r.confirm){this.setData({mergeVisible:false});this.submit({reviewAction:"MERGE",configId:c._id||c.id,reactivate:c.isActive===false,reason:this.data.form.reason.trim()});}}});},
 async submit(data){this.setData({operating:true});try{await api.submitCategoryReview({id:this.data.id,...data});await this.load();wx.showToast({title:"审核处理成功",icon:"success"});}catch(e){wx.showToast({title:e.message||"审核处理失败",icon:"none"});}finally{this.setData({operating:false});}},
 withSubscription(next){if(this.subscriptionPromptInFlight)return;this.subscriptionPromptInFlight=true;const requested=requestLowCountSubscriptions([{templateId:CATEGORY_REVIEW_TEMPLATE_ID,status:this.data.categoryReviewSubscription,save:status=>api.saveCategoryReviewSubscription({templateId:CATEGORY_REVIEW_TEMPLATE_ID,status}).then(result=>{this.setData({categoryReviewSubscription:result});return result;})}],()=>{this.subscriptionPromptInFlight=false;next();});if(!requested)this.subscriptionPromptInFlight=false;},
 stop(){}
});
