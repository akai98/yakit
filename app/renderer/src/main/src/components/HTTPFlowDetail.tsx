import React, {useEffect, useState, useMemo} from "react"
import {
    Button,
    Card,
    Col,
    Collapse,
    Descriptions,
    Empty,
    PageHeader,
    Row,
    Space,
    Spin,
    Tabs,
    Tag,
    Tooltip,
    Typography
} from "antd"
import {LeftOutlined, RightOutlined} from "@ant-design/icons"
import {HTTPFlow} from "./HTTPFlowTable/HTTPFlowTable"
import {HTTPPacketEditor, IMonacoEditor, NewHTTPPacketEditor} from "../utils/editors"
import {failed} from "../utils/notification"
import {FuzzableParamList} from "./FuzzableParamList"
import {FuzzerResponse} from "../pages/fuzzer/HTTPFuzzerPage"
import {HTTPPacketFuzzable} from "./HTTPHistory"
import {AutoSpin} from "./AutoSpin"
import {ResizeBox} from "./ResizeBox"
import {Buffer} from "buffer"
import {StringToUint8Array, Uint8ArrayToString} from "@/utils/str"
import {HTTPFlowForWebsocketViewer} from "@/pages/websocket/HTTPFlowForWebsocketViewer"
import {WebsocketFrameHistory} from "@/pages/websocket/WebsocketFrameHistory"

import styles from "./hTTPFlowDetail.module.scss"
import {callCopyToClipboard} from "@/utils/basic"
import {useMemoizedFn} from "ahooks"
import {HTTPFlowExtractedDataTable} from "@/components/HTTPFlowExtractedDataTable"
import {showResponseViaResponseRaw} from "@/components/ShowInBrowser"
import {ChromeSvgIcon, SideBarCloseIcon, SideBarOpenIcon} from "@/assets/newIcon"
import {OtherMenuListProps} from "./yakitUI/YakitEditor/YakitEditorType"
import {YakitEmpty} from "./yakitUI/YakitEmpty/YakitEmpty"
import classNames from "classnames"
import { getRemoteValue, setRemoteValue } from "@/utils/kv"
import { NewEditorSelectRange } from "./NewEditorSelectRange"
import { HTTPFuzzerRangeReadOnlyEditorMenu } from "@/pages/fuzzer/HTTPFuzzerEditorMenu"

const {ipcRenderer} = window.require("electron")

export type SendToFuzzerFunc = (req: Uint8Array, isHttps: boolean) => any

export interface HTTPFlowDetailProp extends HTTPPacketFuzzable {
    id: number
    noHeader?: boolean
    onClose?: () => any
    defaultHeight?: number

    //查看前/后一个请求内容
    isFront?: boolean
    isBehind?: boolean
    fetchRequest?: (kind: number) => any
    search?: string
}

const {Text} = Typography

export interface FuzzerResponseToHTTPFlowDetail extends HTTPPacketFuzzable {
    response: FuzzerResponse
    onClosed?: () => any
    index?: number
    data?: FuzzerResponse[]
}

export const FuzzerResponseToHTTPFlowDetail = (rsp: FuzzerResponseToHTTPFlowDetail) => {
    const [response, setResponse] = useState<FuzzerResponse>()
    const [index, setIndex] = useState<number>()
    const [id, setId] = useState(0)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string>()

    useEffect(() => {
        setResponse(rsp.response)
        setIndex(rsp.index)
    }, [rsp.response])

    useEffect(() => {
        if (!response) {
            return
        }
        setLoading(true)
        ipcRenderer
            .invoke("ConvertFuzzerResponseToHTTPFlow", {...response})
            .then((d: HTTPFlow) => {
                if (d.Id <= 0) {
                    return
                }
                setId(d.Id)
            })
            .catch((e) => {
                failed(`分析参数失败: ${e}`)
            })
            .finally(() => setTimeout(() => setLoading(false), 300))
    }, [response])

    const fetchInfo = (kind: number) => {
        if (index === undefined || !rsp.data || rsp.data.length === 0) return

        if (kind === 1) {
            setResponse(rsp.data[index - 1])
            setIndex(index - 1)
        }
        if (kind === 2) {
            setResponse(rsp.data[index + 1])
            setIndex(index + 1)
        }
    }

    if (loading) {
        return <Spin tip={"正在分析详细参数"} />
    }

    return (
        <HTTPFlowDetail
            onClose={rsp.onClosed}
            id={id}
            isFront={index === undefined ? undefined : index === 0}
            isBehind={index === undefined ? undefined : index === (rsp?.data || []).length - 1}
            fetchRequest={fetchInfo}
        />
    )
}

export const HTTPFlowDetail: React.FC<HTTPFlowDetailProp> = (props) => {
    const [flow, setFlow] = useState<HTTPFlow>()
    const [loading, setLoading] = useState(false)
    const [requestEditor, setRequestEditor] = useState<IMonacoEditor>()
    const [responseEditor, setResponseEditor] = useState<IMonacoEditor>()
    const actionFuzzer = [
        {
            id: "send-fuzzer-info",
            label: "发送到Fuzzer",
            contextMenuGroupId: "send-fuzzer-info",
            run: () => {
                ipcRenderer.invoke("send-to-tab", {
                    type: "fuzzer",
                    data: {
                        isHttps: flow?.IsHTTPS,
                        request: Uint8ArrayToString(flow?.Request || new Uint8Array(), "utf8")
                    }
                })
                if (props.onClose) props.onClose()
            }
        }
        // {
        //     id: 'send-to-plugin',
        //     label: '发送到数据包扫描',
        //     contextMenuGroupId: 'send-fuzzer-info',
        //     run: () => ipcRenderer.invoke("send-to-packet-hack", {
        //         request: flow?.Request,
        //         ishttps: flow?.IsHTTPS,
        //         response: flow?.Response
        //     })
        // }
    ]

    useEffect(() => {
        if (props.id <= 0) {
            return
        }
        // ipcRenderer.on(props.hash, (e: any, data: HTTPFlow) => {
        //     setFlow(data)
        //     setTimeout(() => setLoading(false), 300)
        // })
        // ipcRenderer.on(`ERROR:${props.hash}`, (e: any, details: any) => {
        //     failed(`查询该请求失败[${props.hash}]: ` + details)
        // })

        setLoading(true)
        ipcRenderer
            .invoke("GetHTTPFlowById", {Id: props.id})
            .then((data: HTTPFlow) => {
                setFlow(data)
            })
            .catch((e) => {
                failed(`GetHTTPFlowById[${props.id}] failed`)
            })
            .finally(() => setTimeout(() => setLoading(false), 300))
        // ipcRenderer.invoke("get-http-flow", props.hash)

        return () => {
            // ipcRenderer.removeAllListeners(props.hash)
            // ipcRenderer.removeAllListeners(`ERROR:${props.hash}`)
        }
    }, [props.id])

    const onCloseDetails = useMemoizedFn(() => {
        if (props.onClose) props.onClose()
    })

    useEffect(() => {
        // 发送webfuzzer后关闭详情
        ipcRenderer.on("fetch-send-to-tab", onCloseDetails)

        return () => {
            ipcRenderer.removeListener("fetch-send-to-tab", onCloseDetails)
        }
    }, [])

    return (
        <Spin spinning={loading} style={{width: "100%", marginBottom: 24}}>
            {flow ? (
                <>
                    {props.noHeader ? undefined : (
                        <PageHeader
                            title={`请求详情`}
                            subTitle={props.id}
                            extra={
                                props.fetchRequest ? (
                                    <Space>
                                        <Tooltip title={"上一个请求"}>
                                            <Button
                                                type='link'
                                                disabled={!!props.isFront}
                                                icon={<LeftOutlined />}
                                                onClick={() => {
                                                    props?.fetchRequest!(1)
                                                }}
                                            ></Button>
                                        </Tooltip>
                                        <Tooltip title={"下一个请求"}>
                                            <Button
                                                type='link'
                                                disabled={!!props.isBehind}
                                                icon={<RightOutlined />}
                                                onClick={() => {
                                                    props?.fetchRequest!(2)
                                                }}
                                            ></Button>
                                        </Tooltip>
                                    </Space>
                                ) : (
                                    <></>
                                )
                            }
                        />
                    )}
                    <Space direction={"vertical"} style={{width: "100%"}}>
                        <Descriptions column={4} bordered={true} size={"small"}>
                            <Descriptions.Item key={"method"} span={1} label={"HTTP 方法"}>
                                <Tag color={"geekblue"}>
                                    <Text style={{maxWidth: 500}}>{flow.Method}</Text>
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item key={"url"} span={3} label={"请求 URL"}>
                                <Text style={{maxWidth: 500}} copyable={true}>
                                    {flow.Url}
                                </Text>
                            </Descriptions.Item>
                            <Descriptions.Item key={"https"} span={1} label={"HTTPS"}>
                                <Tag color={"geekblue"}>
                                    <div style={{maxWidth: 500}}>{flow.IsHTTPS ? "True" : "False"}</div>
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item key={"status"} span={1} label={"StatusCode"}>
                                <Tag color={"geekblue"}>{flow.StatusCode}</Tag>
                            </Descriptions.Item>
                            <Descriptions.Item key={"size"} span={1} label={"Body大小"}>
                                <Tag color={"geekblue"}>
                                    <div style={{maxWidth: 500}}>{flow.BodySizeVerbose}</div>
                                </Tag>
                            </Descriptions.Item>
                            <Descriptions.Item key={"type"} span={1} label={"Content-Type"}>
                                <Tag color={"geekblue"}>
                                    <div style={{maxWidth: 500}}>{flow.ContentType}</div>
                                </Tag>
                            </Descriptions.Item>
                        </Descriptions>
                        <div style={{width: "100%", overflow: "auto"}}>
                            {flow.GetParams.length > 0 || flow.PostParams.length > 0 || flow.CookieParams.length > 0 ? (
                                <Tabs>
                                    {flow.GetParams.length > 0 && (
                                        <Tabs.TabPane key={"get"} tab={"GET 参数"}>
                                            <FuzzableParamList
                                                data={flow.GetParams}
                                                sendToWebFuzzer={() => {
                                                    if (props.onClose) props.onClose()
                                                }}
                                            />
                                        </Tabs.TabPane>
                                    )}
                                    {flow.PostParams.length > 0 && (
                                        <Tabs.TabPane key={"post"} tab={"POST 参数"}>
                                            <FuzzableParamList
                                                data={flow.PostParams}
                                                sendToWebFuzzer={() => {
                                                    if (props.onClose) props.onClose()
                                                }}
                                            />
                                        </Tabs.TabPane>
                                    )}
                                    {flow.CookieParams.length > 0 && (
                                        <Tabs.TabPane key={"cookie"} tab={"Cookie 参数"}>
                                            <FuzzableParamList
                                                data={flow.CookieParams}
                                                sendToWebFuzzer={() => {
                                                    if (props.onClose) props.onClose()
                                                }}
                                            />
                                        </Tabs.TabPane>
                                    )}
                                </Tabs>
                            ) : (
                                ""
                            )}
                        </div>

                        <Row gutter={8}>
                            <Col span={12}>
                                <Card title={"原始 HTTP 请求"} size={"small"} bodyStyle={{padding: 0}}>
                                    <div style={{height: 350}}>
                                        <NewEditorSelectRange
                                            readOnly={true}
                                            hideSearch={true}
                                            noHex={true}
                                            noHeader={true}
                                            originValue={new Buffer(flow.Request)}
                                            defaultHttps={flow?.IsHTTPS}
                                            // actions={[...actionFuzzer]}
                                            rangeId='http.flow.detail.request.read.only.widget'
                                            rangeNode={(close, editorInfo) => (
                                                <HTTPFuzzerRangeReadOnlyEditorMenu
                                                    editorInfo={editorInfo}
                                                    rangeValue={
                                                        (requestEditor &&
                                                            requestEditor.getModel()?.getValueInRange(requestEditor.getSelection() as any)) ||
                                                        ""
                                                    }
                                                />
                                            )}
                                            onEditor={setRequestEditor}
                                        />
                                    </div>
                                </Card>
                            </Col>
                            <Col span={12}>
                                <Card title={"原始 HTTP 响应"} size={"small"} bodyStyle={{padding: 0}}>
                                    <div style={{height: 350}}>
                                        <NewEditorSelectRange
                                            readOnly={true}
                                            hideSearch={true}
                                            noHex={true}
                                            noHeader={true}
                                            originValue={new Buffer(flow.Response)}
                                            defaultHttps={flow?.IsHTTPS}
                                            // actions={[...actionFuzzer]}
                                            webFuzzerValue={new Buffer(flow.Request)}
                                            rangeId='http.flow.detail.response.read.only.widget'
                                            rangeNode={(close, editorInfo) => (
                                                <HTTPFuzzerRangeReadOnlyEditorMenu
                                                    editorInfo={editorInfo}
                                                    rangeValue={
                                                        (responseEditor &&
                                                            responseEditor.getModel()?.getValueInRange(responseEditor.getSelection() as any)) ||
                                                        ""
                                                    }
                                                />
                                            )}
                                            onEditor={setResponseEditor}
                                        />
                                    </div>
                                </Card>
                            </Col>
                        </Row>

                        {/*<Collapse>*/}
                        {/*    <Collapse.Panel key={"request-raw"} header={"原始 HTTP 请求数据包内容"}>*/}

                        {/*    </Collapse.Panel>*/}
                        {/*    <Collapse.Panel key={"response-raw"} header={"原始 HTTP 响应数据包内容"}>*/}

                        {/*    </Collapse.Panel>*/}
                        {/*</Collapse>*/}
                        <Row gutter={8}>
                            <Col span={12}>
                                <Collapse defaultActiveKey={"request"}>
                                    <Collapse.Panel key={"request"} header={"Request Headers"}>
                                        <Descriptions
                                            className={styles["http-flow-detail-descriptions"]}
                                            bordered={true}
                                            column={2}
                                            size={"small"}
                                        >
                                            {(flow?.RequestHeader || [])
                                                .sort((i, e) => {
                                                    return i.Header.localeCompare(e.Header)
                                                })
                                                .map((i) => {
                                                    return (
                                                        <Descriptions.Item
                                                            key={i.Header}
                                                            span={2}
                                                            label={
                                                                <Text style={{width: 240}}>
                                                                    <Tooltip title={i.Header}>
                                                                        <Tag
                                                                            className='content-ellipsis'
                                                                            style={{maxWidth: "100%"}}
                                                                        >
                                                                            {i.Header}
                                                                        </Tag>
                                                                    </Tooltip>
                                                                </Text>
                                                            }
                                                        >
                                                            <Text
                                                                copyable={true}
                                                                style={{width: "100%", maxWidth: "100%"}}
                                                                ellipsis={{tooltip: true}}
                                                            >
                                                                {i.Value}
                                                            </Text>
                                                        </Descriptions.Item>
                                                    )
                                                })}
                                        </Descriptions>
                                    </Collapse.Panel>
                                </Collapse>
                            </Col>
                            <Col span={12}>
                                <Collapse defaultActiveKey={"response"}>
                                    <Collapse.Panel key={"response"} header={"Response Headers"}>
                                        <Descriptions
                                            className={styles["http-flow-detail-descriptions"]}
                                            bordered={true}
                                            column={2}
                                            size={"small"}
                                        >
                                            {(flow?.ResponseHeader || [])
                                                .sort((i, e) => {
                                                    return i.Header.localeCompare(e.Header)
                                                })
                                                .map((i) => {
                                                    return (
                                                        <Descriptions.Item
                                                            key={i.Header}
                                                            span={2}
                                                            label={
                                                                <Text style={{width: 240}}>
                                                                    <Tooltip title={i.Header}>
                                                                        <Tag
                                                                            className='content-ellipsis'
                                                                            style={{maxWidth: "100%"}}
                                                                        >
                                                                            {i.Header}
                                                                        </Tag>
                                                                    </Tooltip>
                                                                </Text>
                                                            }
                                                        >
                                                            <Text
                                                                copyable={true}
                                                                style={{width: "100%", maxWidth: "100%"}}
                                                                ellipsis={{tooltip: true}}
                                                            >
                                                                {i.Value}
                                                            </Text>
                                                        </Descriptions.Item>
                                                    )
                                                })}
                                        </Descriptions>
                                    </Collapse.Panel>
                                </Collapse>
                            </Col>
                        </Row>
                    </Space>
                </>
            ) : (
                ""
            )}
        </Spin>
    )
}

type HTTPFlowInfoType = "domains" | "json" | "rules"

export const HTTPFlowDetailMini: React.FC<HTTPFlowDetailProp> = (props) => {
    const { id } = props
    const [flow, setFlow] = useState<HTTPFlow>()
    const [isSelect,setIsSelect] = useState<boolean>(false)
    const [loading, setLoading] = useState(false)
    const [infoType, setInfoType] = useState<HTTPFlowInfoType>()
    const [infoTypeLoading, setInfoTypeLoading] = useState(false)
    const [existedInfoType, setExistedInfoType] = useState<HTTPFlowInfoType[]>([])
    const [isFold, setFold] = useState<boolean>(false)
    useEffect(() => {
        if (!id) {
            setIsSelect(false)
            return
        }
        setIsSelect(true)
        getRemoteValue("IsFoldValue").then((data) => {
            if (!data) {
                return
            }
            const is:boolean = JSON.parse(data).is
            setFold(is)
        })
        setFlow(undefined)
        setLoading(true)
        ipcRenderer
            .invoke("GetHTTPFlowById", {Id: id})
            .then((i: HTTPFlow) => {
                setFlow(i)
                const existedExtraInfos: HTTPFlowInfoType[] = []
                ipcRenderer
                    .invoke("QueryMITMRuleExtractedData", {
                        Pagination: {
                            Order: "asc",
                            OrderBy: "created_at",
                            Page: 1,
                            Limit: 1
                        },
                        HTTPFlowHash: i.Hash
                    })
                    .then((rsp: {Total: number}) => {
                        if (rsp.Total > 0) {
                            existedExtraInfos.push("rules")
                        }
                    })
                    .catch((e) => {
                        failed("获取规则提取数据失败")
                    })
                    .finally(() => {
                        if ((i.Domains || []).length > 0 || (i.RootDomains || []).length > 0) {
                            existedExtraInfos.push("domains")
                        }

                        if ((i.JsonObjects || []).length > 0) {
                            existedExtraInfos.push("json")
                        }

                        if (existedExtraInfos.length > 0) {
                            setInfoType(existedExtraInfos[0])
                            setExistedInfoType([...existedExtraInfos])
                        } else {
                            setInfoType(undefined)
                            setExistedInfoType([])
                        }
                    })
            })
            .catch((e: any) => {
                failed(`Query HTTPFlow failed: ${e}`)
            })
            .finally(() => {
                setTimeout(() => setLoading(false), 300)
            })
        return () => {
            setExistedInfoType([])
        }
    }, [id])

    useEffect(() => {
        if (!infoType) {
            return
        }
        setInfoTypeLoading(true)
        setTimeout(() => setInfoTypeLoading(false), 300)
    }, [infoType])

    const spinning = !flow || loading

    const mainCol: number = useMemo(() => {
        let col: number = existedInfoType.length > 0 ? 19 : 24
        if (isFold) {
            col = 24
        }
        return col
    }, [existedInfoType.length, isFold])

    return isSelect ? (
        <AutoSpin spinning={spinning} tip={"选择想要查看的请求 / 等待加载"}>
            <div className={styles["http-history-box"]}>
                <Row className={styles["http-history-detail-wrapper"]} gutter={8}>
                    <Col span={mainCol} style={{height: "100%"}}>
                        <HTTPFlowDetailRequestAndResponse loading={loading} flow={flow} {...props} />
                    </Col>
                    {infoType !== "rules" && existedInfoType.filter((i) => i !== "rules").length > 0 && !isFold && (
                        <Col span={5}>
                            <NewHTTPPacketEditor
                                title={
                                    <Button.Group size={"small"}>
                                        {existedInfoType.map((i) => {
                                            return (
                                                <Button
                                                    type={infoType === i ? "primary" : "default"}
                                                    onClick={() => {
                                                        setInfoType(i)
                                                    }}
                                                    key={i}
                                                >
                                                    {infoTypeVerbose(i)}
                                                </Button>
                                            )
                                        })}
                                    </Button.Group>
                                }
                                readOnly={true}
                                noLineNumber={true}
                                noMinimap={true}
                                noHex={true}
                                hideSearch={true}
                                refreshTrigger={infoType}
                                loading={infoTypeLoading}
                                extraEnd={
                                    <div className={classNames(styles["http-history-fold-box"])}>
                                        <div className={styles["http-history-icon-box"]}>
                                            <Tooltip placement='top' title='向右收起'>
                                                <SideBarOpenIcon
                                                    className={styles["fold-icon"]}
                                                    onClick={() => {
                                                        setRemoteValue("IsFoldValue", JSON.stringify({is:true}))
                                                        setFold(true)
                                                    }}
                                                />
                                            </Tooltip>
                                        </div>
                                    </div>
                                }
                                originValue={(() => {
                                    switch (infoType) {
                                        case "domains":
                                            return StringToUint8Array(
                                                "# 根域 (Root-Domains)\r\n" +
                                                    (flow?.RootDomains || []).join("\r\n") +
                                                    "\r\n\r\n# 域名 (Domain) \r\n" +
                                                    (flow?.Domains || []).join("\r\n")
                                            )
                                        case "json":
                                            return StringToUint8Array((flow?.JsonObjects || []).join("\r\n"))
                                        default:
                                            return new Uint8Array()
                                    }
                                })()}
                                editorOperationRecord='HTTP_FLOW_DETAIL_MINI'
                            />
                        </Col>
                    )}
                    {infoType === "rules" && existedInfoType.filter((i) => i === "rules").length > 0 && !isFold && (
                        <Col span={5}>
                            <HTTPFlowExtractedDataTable
                                httpFlowHash={flow?.Hash || ""}
                                title={
                                    <div className={styles['table-header']}>
                                        <Button.Group size={"small"}>
                                        {existedInfoType.map((i) => {
                                            return (
                                                <Button
                                                    type={infoType === i ? "primary" : "default"}
                                                    onClick={() => {
                                                        setInfoType(i)
                                                    }}
                                                    key={i}
                                                >
                                                    {infoTypeVerbose(i)}
                                                </Button>
                                            )
                                        })}
                                    </Button.Group>
                                    <div className={classNames(styles["http-history-fold-box"])}>
                                        <div className={styles["http-history-icon-box"]}>
                                            <Tooltip placement='top' title='向右收起'>
                                                <SideBarOpenIcon
                                                    className={styles["fold-icon"]}
                                                    onClick={() => {
                                                        setRemoteValue("IsFoldValue", JSON.stringify({is:true}))
                                                        setFold(true)
                                                    }}
                                                />
                                            </Tooltip>
                                        </div>
                                    </div>
                                    </div>
                                    
                                }
                            />
                        </Col>
                    )}
                </Row>
                {isFold && (
                    <div
                        className={classNames(styles["http-history-fold-box"], styles["http-history-fold-border-box"])}
                    >
                        <div
                            className={classNames(
                                styles["http-history-icon-box"],
                                styles["http-history-icon-paading-box"]
                            )}
                        >
                            <Tooltip placement='top' title='向左展开'>
                                <SideBarCloseIcon className={styles["fold-icon"]} onClick={() => {
                                        setRemoteValue("IsFoldValue", JSON.stringify({is:false}))
                                        setFold(false)
                                    }} />
                            </Tooltip>
                        </div>
                    </div>
                )}
            </div>
        </AutoSpin>
    ) : (
        <YakitEmpty style={{paddingTop: 48}} title='未选中 HTTP History 数据' />
    )
}

interface HTTPFlowDetailRequestAndResponseProps extends HTTPFlowDetailProp {
    flow?: HTTPFlow
    loading: boolean
}
export const HTTPFlowDetailRequestAndResponse: React.FC<HTTPFlowDetailRequestAndResponseProps> = React.memo((props) => {
    const {flow, sendToWebFuzzer, defaultHeight, defaultHttps, search, loading} = props
    const requestEditorRightMenu: OtherMenuListProps = useMemo(() => {
        return {
            copyRequestBase64Body: {
                menu: [
                    {
                        key: "copy-request-base64-body",
                        label: "复制请求Body (Base64)"
                    }
                ],
                onRun: () => {
                    callCopyToClipboard(flow?.RawRequestBodyBase64 || "")
                }
            }
        }
    }, [])
    const responseEditorRightMenu: OtherMenuListProps = useMemo(() => {
        return {
            copyResponseBase64Body: {
                menu: [
                    {
                        key: "copy-response-base64-body",
                        label: "复制响应Body (Base64)"
                    }
                ],
                onRun: () => {
                    callCopyToClipboard(flow?.RawResponseBodyBase64 || "")
                }
            }
        }
    }, [])

    const [reqFirstEditor, setReqFirstEditor] = useState<IMonacoEditor>()
    const [reqSecondEditor, setReqSecondEditor] = useState<IMonacoEditor>()
    return (
        <ResizeBox
            firstNode={() => {
                if (flow === undefined) {
                    return <Empty description={"选择想要查看的 HTTP 记录请求"} />
                }
                if (flow?.IsWebsocket) {
                    return <HTTPFlowForWebsocketViewer flow={flow} />
                }
                return (
                    <NewEditorSelectRange
                        originValue={flow?.Request || new Uint8Array()}
                        readOnly={true}
                        noLineNumber={true}
                        sendToWebFuzzer={sendToWebFuzzer}
                        defaultHeight={defaultHeight}
                        loading={loading}
                        defaultHttps={defaultHttps}
                        hideSearch={true}
                        noHex={true}
                        noMinimap={true}
                        contextMenu={flow?.RawRequestBodyBase64 ? requestEditorRightMenu : undefined}
                        // 这个为了解决不可见字符的问题
                        defaultPacket={!!flow?.SafeHTTPRequest ? flow.SafeHTTPRequest : undefined}
                        extra={flow.InvalidForUTF8Request ? <Tag color={"red"}>含二进制流</Tag> : undefined}
                        defaultSearchKeyword={search}
                        editorOperationRecord='HTTP_FLOW_DETAIL_REQUEST_AND_REQUEST'
                        onEditor={setReqFirstEditor}
                        rangeId='http.flow.detail.first.range.read.widget'
                        rangeNode={(close, editorInfo) => (
                            <HTTPFuzzerRangeReadOnlyEditorMenu
                                editorInfo={editorInfo}
                                rangeValue={
                                    (reqFirstEditor &&
                                        reqFirstEditor.getModel()?.getValueInRange(reqFirstEditor.getSelection() as any)) ||
                                    ""
                                }
                            />
                        )}
                    />
                )
            }}
            firstMinSize={300}
            secondNode={() => {
                if (flow === undefined) {
                    return <Empty description={"选择想要查看的 HTTP 记录响应"} />
                }
                if (flow?.IsWebsocket) {
                    return <WebsocketFrameHistory websocketHash={flow.WebsocketHash || ""} />
                }
                return (
                    <NewEditorSelectRange
                        contextMenu={flow?.RawResponseBodyBase64 ? responseEditorRightMenu : undefined}
                        extra={[
                            <Button
                                className={styles["extra-chrome-btn"]}
                                type={"text"}
                                size={"small"}
                                icon={<ChromeSvgIcon />}
                                onClick={() => {
                                    showResponseViaResponseRaw(flow?.Response)
                                }}
                            />
                        ]}
                        isResponse={true}
                        noHex={true}
                        noMinimap={(flow?.Response || new Uint8Array()).length < 1024 * 2}
                        loading={loading}
                        originValue={flow?.Response || new Uint8Array()}
                        readOnly={true}
                        defaultHeight={props.defaultHeight}
                        hideSearch={true}
                        defaultSearchKeyword={props.search}
                        defaultHttps={props.defaultHttps}
                        webFuzzerValue={flow?.Request || new Uint8Array()}
                        editorOperationRecord='HTTP_FLOW_DETAIL_REQUEST_AND_RESPONSE'
                        onEditor={setReqSecondEditor}
                        rangeId='http.flow.detail.second.range.read.widget'
                        rangeNode={(close, editorInfo) => (
                            <HTTPFuzzerRangeReadOnlyEditorMenu
                                editorInfo={editorInfo}
                                rangeValue={
                                    (reqSecondEditor &&
                                        reqSecondEditor.getModel()?.getValueInRange(reqSecondEditor.getSelection() as any)) ||
                                    ""
                                }
                            />
                        )}
                    />
                )
            }}
            secondMinSize={300}
        />
    )
})

function infoTypeVerbose(i: HTTPFlowInfoType) {
    switch (i) {
        case "domains":
            return "域名 "
        case "json":
            return "对象 "
        case "rules":
            return "规则 "
        default:
            return "-"
    }
}
